import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import VideocamIcon from '@mui/icons-material/Videocam';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

interface DisplayPromoMedia {
  id: string;
  type: 'PHOTO' | 'VIDEO';
  url: string;
  durationSeconds: number | null;
  sortOrder: number;
}
interface DisplayPromoPlaylist {
  id: string;
  name: string;
  items: DisplayPromoMedia[];
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

function SortableMediaRow({
  media,
  onChangeDuration,
  onDelete,
}: {
  media: DisplayPromoMedia;
  onChangeDuration: (durationSeconds: number) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: media.id });
  return (
    <Stack
      ref={setNodeRef}
      direction="row"
      spacing={1}
      alignItems="center"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{ opacity: isDragging ? 0.5 : 1, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}
    >
      <IconButton size="small" {...attributes} {...listeners} sx={{ cursor: 'grab', touchAction: 'none' }}>
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      {media.type === 'VIDEO' ? (
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 1,
            bgcolor: 'action.selected',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <VideocamIcon fontSize="small" />
        </Box>
      ) : (
        <Box
          component="img"
          src={media.url}
          sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1 }}
        />
      )}
      <Chip size="small" label={media.type === 'VIDEO' ? 'Video' : 'Foto'} />
      {media.type === 'PHOTO' && (
        <TextField
          size="small"
          label="Secondi"
          type="number"
          value={media.durationSeconds ?? 8}
          onChange={(e) => onChangeDuration(Math.max(1, Number(e.target.value) || 1))}
          inputProps={{ min: 1 }}
          sx={{ width: 100 }}
        />
      )}
      <Box sx={{ flexGrow: 1 }} />
      <IconButton size="small" color="error" title="Elimina" onClick={onDelete}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

/**
 * Display Promo (§5.12 di DEVELOPMENT.md): pool di playlist/contenuti
 * condiviso per locale. Quali playlist mandare in onda — e su quali
 * display, dato che un locale può averne più di uno — si decide invece in
 * DisplayPromoAdmin.tsx, pagina principale del modulo.
 */
export function DisplayPromoPlaylists() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [openPlaylist, setOpenPlaylist] = useState<string | false>(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DisplayPromoPlaylist | null>(null);
  const [name, setName] = useState('');
  const [toDelete, setToDelete] = useState<DisplayPromoPlaylist | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

  const playlistsQuery = useQuery({
    queryKey: ['display-promo-playlists'],
    queryFn: async () => (await api.get<DisplayPromoPlaylist[]>('/display-promo/playlists')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['display-promo-playlists'] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim() };
      return editing
        ? (await api.patch(`/display-promo/playlists/${editing.id}`, payload)).data
        : (await api.post('/display-promo/playlists', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      showToast(editing ? 'Playlist aggiornata' : 'Playlist creata');
      setDialogOpen(false);
      setEditing(null);
      setName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/display-promo/playlists/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      showToast('Playlist eliminata');
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ playlistId, file }: { playlistId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return (await api.post(`/display-promo/playlists/${playlistId}/media`, form)).data;
    },
    onSuccess: (_data, { playlistId }) => {
      invalidate();
      setUploadErrors((errs) => ({ ...errs, [playlistId]: '' }));
    },
    onError: (err, { playlistId }) =>
      setUploadErrors((errs) => ({ ...errs, [playlistId]: extractErrorMessage(err) })),
  });

  const updateMediaMutation = useMutation({
    mutationFn: async ({ id, durationSeconds }: { id: string; durationSeconds: number }) =>
      (await api.patch(`/display-promo/media/${id}`, { durationSeconds })).data,
    onSuccess: invalidate,
  });

  const deleteMediaMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/display-promo/media/${id}`)).data,
    onSuccess: invalidate,
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ playlistId, mediaIds }: { playlistId: string; mediaIds: string[] }) =>
      (await api.patch(`/display-promo/playlists/${playlistId}/media/reorder`, { mediaIds })).data,
    onSettled: invalidate,
  });

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const handleMediaDragEnd = (playlist: DisplayPromoPlaylist) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = playlist.items.map((i) => i.id);
    const newIds = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    queryClient.setQueryData<DisplayPromoPlaylist[]>(['display-promo-playlists'], (old) =>
      old?.map((p) => (p.id === playlist.id ? { ...p, items: newIds.map((id) => p.items.find((i) => i.id === id)!) } : p)),
    );
    reorderMutation.mutate({ playlistId: playlist.id, mediaIds: newIds });
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDialogOpen(true);
  };

  const openEdit = (playlist: DisplayPromoPlaylist) => {
    setEditing(playlist);
    setName(playlist.name);
    setDialogOpen(true);
  };

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Button startIcon={<ArrowBackIcon />} sx={{ justifySelf: 'flex-start' }} onClick={() => navigate('/display-promo')}>
        Display Promo
      </Button>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Playlist
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Contenuti (foto/video) condivisi per il locale — quale playlist mandare in onda su quale
            display si decide nella pagina principale "Display Promo".
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Nuova playlist
        </Button>
      </Box>

      {playlistsQuery.data?.map((playlist) => (
        <Accordion
          key={playlist.id}
          expanded={openPlaylist === playlist.id}
          onChange={(_e, expanded) => setOpenPlaylist(expanded ? playlist.id : false)}
          disableGutters
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {playlist.name} ({playlist.items.length})
              </Typography>
              <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
                <IconButton size="small" title="Rinomina" onClick={() => openEdit(playlist)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" title="Elimina" onClick={() => setToDelete(playlist)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ display: 'grid', gap: 1.5 }}>
            {uploadMutation.isPending && uploadMutation.variables?.playlistId === playlist.id && (
              <LinearProgress />
            )}
            {uploadErrors[playlist.id] && <Alert severity="error">{uploadErrors[playlist.id]}</Alert>}

            {playlist.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nessun contenuto ancora caricato.
              </Typography>
            ) : (
              <DndContext
                sensors={dragSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleMediaDragEnd(playlist)}
              >
                <SortableContext items={playlist.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <Stack spacing={1}>
                    {playlist.items.map((media) => (
                      <SortableMediaRow
                        key={media.id}
                        media={media}
                        onChangeDuration={(durationSeconds) =>
                          updateMediaMutation.mutate({ id: media.id, durationSeconds })
                        }
                        onDelete={() => deleteMediaMutation.mutate(media.id)}
                      />
                    ))}
                  </Stack>
                </SortableContext>
              </DndContext>
            )}

            <Button
              component="label"
              variant="outlined"
              startIcon={<UploadFileIcon />}
              sx={{ justifySelf: 'flex-start' }}
            >
              Carica foto o video
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/ogg"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMutation.mutate({ playlistId: playlist.id, file });
                  e.target.value = '';
                }}
              />
            </Button>
          </AccordionDetails>
        </Accordion>
      ))}

      {playlistsQuery.data?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Nessuna playlist ancora creata.
        </Typography>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Rinomina playlist' : 'Nuova playlist'}</DialogTitle>
        <DialogContent sx={{ pt: 4 }}>
          <TextField
            label="Nome (es. Offerte estate)"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {saveMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {extractErrorMessage(saveMutation.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDialogOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!name.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {editing ? 'Salva' : 'Crea'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        title="Eliminare la playlist?"
        message={
          toDelete
            ? `"${toDelete.name}" e i suoi contenuti verranno eliminati. Se è assegnata a un turno o come playlist di default, quello slot resterà senza playlist.`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />
    </Box>
  );
}
