import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ImageLightbox } from '../../components/ImageLightbox';
import { PhotoCropDialog } from '../../components/PhotoCropDialog';

interface BoardMessageRow {
  id: string;
  text: string;
  photoUrl?: string;
  pinned: boolean;
  createdAt: string;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Bacheca del locale: tutti i messaggi, ordinati con i pinnati in cima. */
export function BoardPage() {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pinned, setPinned] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<BoardMessageRow | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [editing, setEditing] = useState<BoardMessageRow | null>(null);
  const [editText, setEditText] = useState('');

  const messagesQuery = useQuery({
    queryKey: ['board-messages'],
    queryFn: async () => (await api.get<BoardMessageRow[]>('/board/messages')).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['board-messages'] });
    queryClient.invalidateQueries({ queryKey: ['board-pinned'] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: message } = await api.post<BoardMessageRow>('/board/messages', {
        text: text.trim(),
        pinned,
      });
      if (photo) {
        const form = new FormData();
        form.append('photo', photo);
        await api.post(`/board/messages/${message.id}/photo`, form);
      }
      return message;
    },
    onSuccess: () => {
      invalidate();
      setText('');
      setPinned(false);
      setPhoto(null);
      setError(null);
      setOpen(false);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const togglePinMutation = useMutation({
    mutationFn: async ({ id, pinned: next }: { id: string; pinned: boolean }) =>
      (await api.patch(`/board/messages/${id}/pin`, { pinned: next })).data,
    onSuccess: invalidate,
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, text: newText }: { id: string; text: string }) =>
      (await api.patch(`/board/messages/${id}`, { text: newText })).data,
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/board/messages/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDelete(null);
    },
  });

  const openCreate = () => {
    setText('');
    setPinned(false);
    setPhoto(null);
    setError(null);
    setOpen(true);
  };

  const startPhotoCrop = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setCropImageSrc(reader.result as string);
    reader.readAsDataURL(file);
  };

  const confirmPhotoCrop = (blob: Blob) => {
    setPhoto(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
    setCropImageSrc(null);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Bacheca</Typography>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Aggiungi
          </Button>
        )}
      </Box>

      <Stack spacing={2}>
        {messagesQuery.data?.map((msg) => (
          <Card key={msg.id} variant="outlined">
            <CardContent sx={{ display: 'flex', gap: 2 }}>
              {msg.photoUrl && (
                <Box
                  component="img"
                  src={msg.photoUrl}
                  alt=""
                  onClick={() => setLightbox(msg.photoUrl!)}
                  sx={{
                    width: 96,
                    height: 96,
                    objectFit: 'cover',
                    borderRadius: 1,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
              )}
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    {msg.pinned && <PushPinIcon fontSize="small" color="primary" />}
                    <Typography variant="caption" color="text.secondary">
                      {new Date(msg.createdAt).toLocaleDateString('it-IT')}
                    </Typography>
                  </Stack>
                  {isAdmin && (
                    <Stack direction="row" spacing={0.5}>
                      <IconButton
                        size="small"
                        title={msg.pinned ? 'Rimuovi dalla home' : 'Pinna in home'}
                        onClick={() =>
                          togglePinMutation.mutate({ id: msg.id, pinned: !msg.pinned })
                        }
                      >
                        {msg.pinned ? (
                          <PushPinIcon fontSize="small" />
                        ) : (
                          <PushPinOutlinedIcon fontSize="small" />
                        )}
                      </IconButton>
                      <IconButton
                        size="small"
                        title="Modifica"
                        onClick={() => {
                          setEditing(msg);
                          setEditText(msg.text);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" title="Elimina" onClick={() => setToDelete(msg)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  )}
                </Stack>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {msg.text}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        ))}
        {messagesQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessun messaggio in bacheca.
          </Typography>
        )}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nuovo messaggio</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 2 }}>
          <TextField
            label="Testo"
            multiline
            minRows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <Button
            variant="outlined"
            component="label"
            startIcon={<PhotoCameraIcon />}
            sx={{ justifySelf: 'flex-start' }}
          >
            {photo ? photo.name : 'Aggiungi foto (opzionale)'}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) startPhotoCrop(file);
                e.target.value = '';
              }}
            />
          </Button>
          <FormControlLabel
            control={<Checkbox checked={pinned} onChange={(e) => setPinned(e.target.checked)} />}
            label="Pinna in home"
          />
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!text.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Aggiungi
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        title="Eliminare il messaggio?"
        message={toDelete ? `"${toDelete.text.slice(0, 80)}" verrà eliminato definitivamente.` : ''}
        loading={deleteMutation.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />

      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Modifica messaggio</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            label="Testo"
            multiline
            minRows={3}
            fullWidth
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setEditing(null)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!editText.trim() || editMutation.isPending}
            onClick={() => editing && editMutation.mutate({ id: editing.id, text: editText.trim() })}
          >
            Salva
          </Button>
        </DialogActions>
      </Dialog>

      <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />

      <PhotoCropDialog
        open={!!cropImageSrc}
        imageSrc={cropImageSrc}
        onCancel={() => setCropImageSrc(null)}
        onConfirm={confirmPhotoCrop}
      />
    </Box>
  );
}
