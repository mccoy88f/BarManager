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
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
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
type InfoBarTheme = 'BLACK_WHITE' | 'GLASS';
type TransitionEffect = 'NONE' | 'FADE' | 'SLIDE_HORIZONTAL' | 'SLIDE_VERTICAL' | 'ZOOM';
type Orientation = 'HORIZONTAL' | 'VERTICAL';

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
  showInfoBar: boolean;
  infoBarTheme: InfoBarTheme;
  transitionEffect: TransitionEffect;
  orientation: Orientation;
  headerText: string | null;
  headerLogoUrl: string | null;
  schedules: ScheduleSlot[];
}

const DAY_LABELS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const SHIFT_LABELS: Record<Shift, string> = { LUNCH: 'Pranzo', DINNER: 'Cena' };
const NO_PLAYLIST = '__none__';
const INFO_BAR_THEME_LABELS: Record<InfoBarTheme, string> = { BLACK_WHITE: 'Bianco e nero', GLASS: 'Vetro (trasparente)' };
const ORIENTATION_LABELS: Record<Orientation, string> = { HORIZONTAL: 'Orizzontale', VERTICAL: 'Verticale' };
const TRANSITION_LABELS: Record<TransitionEffect, string> = {
  NONE: 'Nessuna (taglio netto)',
  FADE: 'Dissolvenza',
  SLIDE_HORIZONTAL: 'Scorrimento orizzontale',
  SLIDE_VERTICAL: 'Scorrimento verticale',
  ZOOM: 'Zoom',
};

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

interface KioskDevice {
  id: string;
  code: string;
  name: string | null;
  deviceInfo: string | null;
  ipAddress: string | null;
  appVersion: string | null;
  lastSeenAt: string;
  createdAt: string;
}

/** Dispositivi Android (TV Box / tablet) con l'app BarManager Kiosk collegati a questo schermo */
function ScreenKioskDevices({ screenId }: { screenId: string }) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [openAdd, setOpenAdd] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [toUnlink, setToUnlink] = useState<KioskDevice | null>(null);

  const kiosksQuery = useQuery({
    queryKey: ['display-promo-kiosks', screenId],
    queryFn: async () => (await api.get<KioskDevice[]>(`/display-promo/screens/${screenId}/kiosks`)).data,
  });

  const pairMutation = useMutation({
    mutationFn: async () => {
      const trimmed = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!trimmed) throw new Error('Inserisci il codice del dispositivo');
      return (await api.post(`/display-promo/screens/${screenId}/kiosks`, { code: trimmed, name: name.trim() || undefined })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['display-promo-kiosks', screenId] });
      showToast('Dispositivo collegato con successo allo schermo');
      setOpenAdd(false);
      setCode('');
      setName('');
    },
    onError: (err: any) => {
      showToast({ message: err?.response?.data?.message || 'Errore durante il collegamento', severity: 'error' });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      return (await api.delete(`/display-promo/screens/${screenId}/kiosks/${deviceId}`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['display-promo-kiosks', screenId] });
      showToast('Dispositivo scollegato');
      setToUnlink(null);
    },
    onError: (err: any) => {
      showToast({ message: err?.response?.data?.message || 'Errore durante lo scollegamento', severity: 'error' });
    },
  });

  const kiosks = kiosksQuery.data || [];

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="subtitle2" fontWeight={700}>
            Dispositivi BarManager Kiosk collegati
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Collega TV Box o tablet con l'app nativa Kiosk inserendo il codice mostrato a schermo.
          </Typography>
        </Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setOpenAdd(true)}
        >
          Aggiungi codice
        </Button>
      </Stack>

      {kiosks.length === 0 ? (
        <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
          Nessun dispositivo Kiosk attualmente collegato a questo schermo. Apri l'app <strong>BarManager Kiosk</strong> sul tuo box Android e inserisci qui il codice.
        </Alert>
      ) : (
        <Stack spacing={1}>
          {kiosks.map((kiosk) => {
            const lastSeen = kiosk.lastSeenAt ? new Date(kiosk.lastSeenAt) : null;
            const isRecent = lastSeen ? Date.now() - lastSeen.getTime() < 120_000 : false;
            return (
              <Box
                key={kiosk.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  p: 1.25,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Chip
                    label={kiosk.code}
                    color="primary"
                    variant="filled"
                    sx={{ fontWeight: 800, letterSpacing: 1.5, fontFamily: 'monospace' }}
                  />
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {kiosk.name || 'Dispositivo Kiosk'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {kiosk.deviceInfo ? `${kiosk.deviceInfo} • ` : ''}
                      {isRecent ? '🟢 Online' : lastSeen ? `Ultimo contatto: ${lastSeen.toLocaleDateString()} ${lastSeen.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </Typography>
                  </Box>
                </Stack>
                <IconButton
                  size="small"
                  color="error"
                  title="Scollega dispositivo"
                  onClick={() => setToUnlink(kiosk)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            );
          })}
        </Stack>
      )}

      {/* Dialog per inserire il codice */}
      <Dialog open={openAdd} onClose={() => setOpenAdd(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Collega BarManager Kiosk</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '16px !important' }}>
          <Typography variant="body2" color="text.secondary">
            Inserisci il codice di 6 caratteri mostrato sull'app BarManager Kiosk del tuo TV Box o schermo:
          </Typography>
          <TextField
            autoFocus
            label="Codice dispositivo"
            placeholder="es. AB12CD"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            inputProps={{ maxLength: 10, style: { textTransform: 'uppercase', fontFamily: 'monospace', fontWeight: 700, letterSpacing: 2 } }}
            fullWidth
            required
          />
          <TextField
            label="Nome o posizione (facoltativo)"
            placeholder="es. TV Bancone, Schermo Ingresso"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenAdd(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!code.trim() || pairMutation.isPending}
            onClick={() => pairMutation.mutate()}
          >
            {pairMutation.isPending ? 'Collegamento...' : 'Collega'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Conferma scollegamento */}
      <ConfirmDialog
        open={Boolean(toUnlink)}
        title="Scollega dispositivo Kiosk"
        message={`Sei sicuro di voler scollegare il dispositivo ${toUnlink?.name || toUnlink?.code}? Lo schermo tornerà alla schermata con il codice di abbinamento.`}
        confirmColor="error"
        confirmLabel="Scollega"
        onConfirm={() => toUnlink && unlinkMutation.mutate(toUnlink.id)}
        onCancel={() => setToUnlink(null)}
      />
    </Box>
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

  const setShowInfoBarMutation = useMutation({
    mutationFn: async ({ id, showInfoBar }: { id: string; showInfoBar: boolean }) =>
      (await api.patch(`/display-promo/screens/${id}`, { showInfoBar })).data,
    onSuccess: invalidateScreens,
  });

  const setInfoBarThemeMutation = useMutation({
    mutationFn: async ({ id, infoBarTheme }: { id: string; infoBarTheme: InfoBarTheme }) =>
      (await api.patch(`/display-promo/screens/${id}`, { infoBarTheme })).data,
    onSuccess: invalidateScreens,
  });

  const setTransitionEffectMutation = useMutation({
    mutationFn: async ({ id, transitionEffect }: { id: string; transitionEffect: TransitionEffect }) =>
      (await api.patch(`/display-promo/screens/${id}`, { transitionEffect })).data,
    onSuccess: invalidateScreens,
  });

  const setOrientationMutation = useMutation({
    mutationFn: async ({ id, orientation }: { id: string; orientation: Orientation }) =>
      (await api.patch(`/display-promo/screens/${id}`, { orientation })).data,
    onSuccess: invalidateScreens,
  });

  const setHeaderTextMutation = useMutation({
    mutationFn: async ({ id, headerText }: { id: string; headerText: string | null }) =>
      (await api.patch(`/display-promo/screens/${id}`, { headerText })).data,
    onSuccess: invalidateScreens,
  });

  const uploadHeaderLogoMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return (await api.post(`/display-promo/screens/${id}/header-logo`, form)).data;
    },
    onSuccess: invalidateScreens,
  });

  const removeHeaderLogoMutation = useMutation({
    mutationFn: async (id: string) =>
      (await api.patch(`/display-promo/screens/${id}`, { headerLogoUrl: null })).data,
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

            <Card variant="outlined">
              <CardContent>
                <ScreenKioskDevices screenId={screen.id} />
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

            <TextField
              select
              label="Orientamento"
              helperText="Solo organizzativo: la pagina si adatta già da sola al dispositivo reale."
              value={screen.orientation}
              onChange={(e) =>
                setOrientationMutation.mutate({ id: screen.id, orientation: e.target.value as Orientation })
              }
              sx={{ maxWidth: 280 }}
            >
              {(Object.entries(ORIENTATION_LABELS) as [Orientation, string][]).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>

            <FormControlLabel
              control={
                <Switch
                  checked={screen.showInfoBar}
                  onChange={(e) => setShowInfoBarMutation.mutate({ id: screen.id, showInfoBar: e.target.checked })}
                />
              }
              label="Mostra orologio, meteo e notizie attorno al carosello (stile telegiornale)"
            />

            {screen.showInfoBar && (
              <TextField
                select
                label="Tema delle barre"
                value={screen.infoBarTheme}
                onChange={(e) =>
                  setInfoBarThemeMutation.mutate({ id: screen.id, infoBarTheme: e.target.value as InfoBarTheme })
                }
                sx={{ maxWidth: 280 }}
              >
                {(Object.entries(INFO_BAR_THEME_LABELS) as [InfoBarTheme, string][]).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {screen.showInfoBar && (
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  In alto a sinistra nella barra: un logo (se caricato) ha sempre la precedenza su un
                  testo personalizzato, che a sua volta ha la precedenza sul nome del locale.
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  {screen.headerLogoUrl && (
                    <Box
                      component="img"
                      src={screen.headerLogoUrl}
                      alt="Logo intestazione"
                      sx={{ height: 40, maxWidth: 160, objectFit: 'contain', bgcolor: 'black', borderRadius: 1, p: 0.5 }}
                    />
                  )}
                  <Button component="label" size="small" variant="outlined">
                    {screen.headerLogoUrl ? 'Cambia logo' : 'Carica logo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadHeaderLogoMutation.mutate({ id: screen.id, file });
                        e.target.value = '';
                      }}
                    />
                  </Button>
                  {screen.headerLogoUrl && (
                    <Button size="small" color="error" onClick={() => removeHeaderLogoMutation.mutate(screen.id)}>
                      Rimuovi logo
                    </Button>
                  )}
                </Stack>
                <TextField
                  label="Testo personalizzato (se niente logo)"
                  placeholder={screen.headerLogoUrl ? 'Ignorato: è caricato un logo' : 'Es. Offerte di oggi'}
                  disabled={!!screen.headerLogoUrl}
                  defaultValue={screen.headerText ?? ''}
                  onBlur={(e) =>
                    setHeaderTextMutation.mutate({ id: screen.id, headerText: e.target.value.trim() || null })
                  }
                  sx={{ maxWidth: 360 }}
                />
              </Stack>
            )}

            <TextField
              select
              label="Animazione tra i contenuti"
              value={screen.transitionEffect}
              onChange={(e) =>
                setTransitionEffectMutation.mutate({ id: screen.id, transitionEffect: e.target.value as TransitionEffect })
              }
              sx={{ maxWidth: 280 }}
            >
              {(Object.entries(TRANSITION_LABELS) as [TransitionEffect, string][]).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
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
