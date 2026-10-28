import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import QRCode from 'qrcode';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

type Shift = 'LUNCH' | 'DINNER';

interface DisplayPromoPlaylist {
  id: string;
  name: string;
}
interface ScheduleSlot {
  dayOfWeek: number;
  shift: Shift;
  playlistId: string;
}
interface DisplayPromoScreen {
  id: string;
  name: string;
  defaultPlaylistId: string | null;
  schedules: ScheduleSlot[];
}

const DAY_LABELS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const SHIFT_LABELS: Record<Shift, string> = { LUNCH: 'Pranzo', DINNER: 'Cena' };
const NO_PLAYLIST = '__none__';

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Griglia 7 giorni × 2 turni per UN singolo display: ogni schermo ha la propria programmazione, indipendente dagli altri. */
function ScreenSchedule({ screenId, playlists }: { screenId: string; playlists: DisplayPromoPlaylist[] }) {
  const queryClient = useQueryClient();

  const scheduleQuery = useQuery({
    queryKey: ['display-promo-schedule', screenId],
    queryFn: async () => (await api.get<ScheduleSlot[]>(`/display-promo/screens/${screenId}/schedule`)).data,
  });

  const slotByKey = useMemo(() => {
    const map = new Map<string, string>();
    scheduleQuery.data?.forEach((slot) => map.set(`${slot.dayOfWeek}-${slot.shift}`, slot.playlistId));
    return map;
  }, [scheduleQuery.data]);

  const setSlotMutation = useMutation({
    mutationFn: async ({ dayOfWeek, shift, playlistId }: { dayOfWeek: number; shift: Shift; playlistId: string | null }) =>
      (await api.patch(`/display-promo/screens/${screenId}/schedule/${dayOfWeek}/${shift}`, { playlistId })).data,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['display-promo-schedule', screenId] }),
  });

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `140px repeat(2, minmax(170px, 1fr))`,
          gap: 1,
          minWidth: 500,
        }}
      >
        <Box />
        {(['LUNCH', 'DINNER'] as Shift[]).map((shift) => (
          <Typography key={shift} variant="subtitle2" fontWeight={700} textAlign="center">
            {SHIFT_LABELS[shift]}
          </Typography>
        ))}
        {DAY_LABELS.map((dayLabel, dayOfWeek) => (
          <Fragment key={dayOfWeek}>
            <Typography variant="body2" fontWeight={600} sx={{ alignSelf: 'center' }}>
              {dayLabel}
            </Typography>
            {(['LUNCH', 'DINNER'] as Shift[]).map((shift) => {
              const value = slotByKey.get(`${dayOfWeek}-${shift}`) ?? NO_PLAYLIST;
              return (
                <TextField
                  key={`${dayOfWeek}-${shift}`}
                  select
                  size="small"
                  value={value}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSlotMutation.mutate({ dayOfWeek, shift, playlistId: next === NO_PLAYLIST ? null : next });
                  }}
                >
                  <MenuItem value={NO_PLAYLIST}>
                    <em>Playlist di default</em>
                  </MenuItem>
                  {playlists.map((playlist) => (
                    <MenuItem key={playlist.id} value={playlist.id}>
                      {playlist.name}
                    </MenuItem>
                  ))}
                </TextField>
              );
            })}
          </Fragment>
        ))}
      </Box>
    </Box>
  );
}

/** Link e QR del display pubblico: un indirizzo diverso per ciascun schermo, dato che ciascuno ha la propria programmazione. */
function ScreenLinkQr({ screenId }: { screenId: string }) {
  const showToast = useToast();
  const url = `${window.location.origin}/display/${screenId}`;
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');

  useEffect(() => {
    QRCode.toDataURL(url, { width: 200, margin: 1 })
      .then(setQrCodeDataUrl)
      .catch(() => setQrCodeDataUrl(''));
  }, [url]);

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
      <Stack spacing={1} sx={{ flexGrow: 1, width: '100%' }}>
        <TextField
          label="URL display"
          value={url}
          size="small"
          InputProps={{ readOnly: true }}
          onFocus={(e) => e.target.select()}
        />
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigator.clipboard?.writeText(url).then(() => showToast('Link copiato'))}
          >
            Copia link
          </Button>
          <Button size="small" variant="outlined" component="a" href={url} target="_blank" rel="noopener noreferrer">
            Apri link
          </Button>
        </Stack>
      </Stack>
      {qrCodeDataUrl && (
        <Box component="img" src={qrCodeDataUrl} alt="QR code display" sx={{ width: 110, height: 110 }} />
      )}
    </Stack>
  );
}

/**
 * Display Promo (§5.12 di DEVELOPMENT.md): un locale può avere PIÙ display
 * fisici diversi (es. "Sala", "Vetrina"), ciascuno con un proprio link/QR
 * e una propria programmazione settimanale — prima si aggiunge il display,
 * poi dentro di esso si sceglie quale playlist mandare in onda per ogni
 * giorno/turno. Le playlist (pool di contenuti) sono condivise per locale
 * e si gestiscono nella pagina "Playlist" (DisplayPromoPlaylists.tsx).
 */
export function DisplayPromoAdmin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [expanded, setExpanded] = useState<string | false>(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DisplayPromoScreen | null>(null);
  const [name, setName] = useState('');
  const [toDelete, setToDelete] = useState<DisplayPromoScreen | null>(null);

  const screensQuery = useQuery({
    queryKey: ['display-promo-screens'],
    queryFn: async () => (await api.get<DisplayPromoScreen[]>('/display-promo/screens')).data,
  });

  const playlistsQuery = useQuery({
    queryKey: ['display-promo-playlists'],
    queryFn: async () => (await api.get<DisplayPromoPlaylist[]>('/display-promo/playlists')).data,
  });

  const invalidateScreens = () => queryClient.invalidateQueries({ queryKey: ['display-promo-screens'] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim() };
      return editing
        ? (await api.patch(`/display-promo/screens/${editing.id}`, payload)).data
        : (await api.post('/display-promo/screens', payload)).data;
    },
    onSuccess: () => {
      invalidateScreens();
      showToast(editing ? 'Display aggiornato' : 'Display creato');
      setDialogOpen(false);
      setEditing(null);
      setName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/display-promo/screens/${id}`)).data,
    onSuccess: () => {
      invalidateScreens();
      setToDelete(null);
      showToast('Display eliminato');
    },
  });

  const setDefaultPlaylistMutation = useMutation({
    mutationFn: async ({ id, defaultPlaylistId }: { id: string; defaultPlaylistId: string | null }) =>
      (await api.patch(`/display-promo/screens/${id}`, { defaultPlaylistId })).data,
    onSuccess: invalidateScreens,
  });

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDialogOpen(true);
  };

  const openEdit = (screen: DisplayPromoScreen) => {
    setEditing(screen);
    setName(screen.name);
    setDialogOpen(true);
  };

  const playlists = playlistsQuery.data ?? [];

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Display Promo
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Schermi pubblicitari pubblici: aggiungi un display per ogni TV/tablet (possono essere più
            di uno), poi scegli dentro ciascuno quale playlist mandare in onda per giorno e turno.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<PlaylistPlayIcon />} onClick={() => navigate('/display-promo/playlists')}>
            Playlist
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Nuovo display
          </Button>
        </Stack>
      </Box>

      {playlists.length === 0 && (
        <Alert severity="info">
          Non hai ancora creato nessuna playlist. Vai su "Playlist" per caricare foto/video prima di
          programmare i display.
        </Alert>
      )}

      {screensQuery.data?.map((screen) => (
        <Accordion
          key={screen.id}
          expanded={expanded === screen.id}
          onChange={(_e, isExpanded) => setExpanded(isExpanded ? screen.id : false)}
          disableGutters
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {screen.name}
              </Typography>
              <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
                <IconButton size="small" title="Rinomina" onClick={() => openEdit(screen)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" title="Elimina" onClick={() => setToDelete(screen)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ display: 'grid', gap: 2.5 }}>
            <Card variant="outlined">
              <CardContent>
                <ScreenLinkQr screenId={screen.id} />
              </CardContent>
            </Card>

            <TextField
              select
              label="Playlist di default"
              helperText="Mostrata fuori dai turni pranzo/cena, e per i turni senza una playlist scelta sotto."
              value={screen.defaultPlaylistId ?? NO_PLAYLIST}
              onChange={(e) =>
                setDefaultPlaylistMutation.mutate({
                  id: screen.id,
                  defaultPlaylistId: e.target.value === NO_PLAYLIST ? null : e.target.value,
                })
              }
              sx={{ maxWidth: 360 }}
            >
              <MenuItem value={NO_PLAYLIST}>
                <em>Nessuna (schermo vuoto)</em>
              </MenuItem>
              {playlists.map((playlist) => (
                <MenuItem key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </MenuItem>
              ))}
            </TextField>

            <Divider />

            <Box>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                Programmazione settimanale
              </Typography>
              <ScreenSchedule screenId={screen.id} playlists={playlists} />
            </Box>
          </AccordionDetails>
        </Accordion>
      ))}

      {screensQuery.data?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Nessun display ancora creato.
        </Typography>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Rinomina display' : 'Nuovo display'}</DialogTitle>
        <DialogContent sx={{ pt: 4 }}>
          <TextField
            label="Nome (es. Sala, Vetrina)"
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
        title="Eliminare il display?"
        message={
          toDelete
            ? `"${toDelete.name}" e la sua programmazione verranno eliminati. Il link/QR di questo display smetterà di funzionare.`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />
    </Box>
  );
}
