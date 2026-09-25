import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import SyncIcon from '@mui/icons-material/Sync';
import ArticleIcon from '@mui/icons-material/Article';
import CheckIcon from '@mui/icons-material/Check';
import EventIcon from '@mui/icons-material/Event';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';
import { useAuthStore } from '../../store/authStore';
import { ACCENT_COLOR_PRESETS, DEFAULT_ACCENT_COLOR } from '../../config/accentColors';
import { OpeningHoursWeekEditor, type OpeningHoursDay } from '../../components/OpeningHoursWeekEditor';
import { SpecialDaysCard } from './SpecialDaysCard';

interface LoyverseSyncSummary {
  categories: number;
  items: number;
  itemsRemoved: number;
  categoriesRemoved: number;
  imagesDownloaded: number;
  imagesSkipped: boolean;
  warnings: string[];
}
interface LoyverseStatus {
  enabled: boolean;
  hasToken: boolean;
  lastSyncAt?: string;
  lastSyncError?: string;
  lastSyncSummary?: LoyverseSyncSummary | null;
}

interface VenueHours {
  id: string;
  name: string;
  email?: string;
  slug: string;
  openingHours: OpeningHoursDay[];
  menuCoverUrl?: string;
  logoUrl?: string;
  menuAddress?: string;
  menuPhone?: string;
  menuInstagramUrl?: string;
  menuFacebookUrl?: string;
  menuWebsiteUrl?: string;
  city?: string;
  vatNumber?: string;
  timezone?: string;
  themeAccentColor?: string | null;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Lista IANA completa (Chrome/Edge/Node — non ancora in Safari/Firefox: in tal caso resta solo il fuso già salvato, selezionabile lo stesso). */
const timezoneOptions: string[] =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Europe/Rome'];

/**
 * Orario "reale" di apertura del locale: usato dal modulo Prenotazioni e dal
 * gating "negozio aperto/chiuso" degli ordini online (§5.10 di
 * DEVELOPMENT.md) — non più per il tag "solo pranzo"/"solo cena" del menù,
 * che da qui in avanti è indipendente (v. pagina "Impostazioni Menù").
 */
export function VenueSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const setCachedThemeAccentColor = useAuthStore((s) => s.setThemeAccentColor);
  const [openingHours, setOpeningHours] = useState<OpeningHoursDay[]>([]);
  const [themeAccentColor, setThemeAccentColor] = useState(DEFAULT_ACCENT_COLOR);

  const [menuSettings, setMenuSettings] = useState({
    name: '',
    email: '',
    menuAddress: '',
    menuPhone: '',
    menuInstagramUrl: '',
    menuFacebookUrl: '',
    menuWebsiteUrl: '',
    city: '',
    vatNumber: '',
    timezone: '',
  });

  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<VenueHours>('/venues/me')).data,
  });

  useEffect(() => {
    if (venueQuery.data) {
      setOpeningHours(venueQuery.data.openingHours);
      setMenuSettings({
        name: venueQuery.data.name ?? '',
        email: venueQuery.data.email ?? '',
        menuAddress: venueQuery.data.menuAddress ?? '',
        menuPhone: venueQuery.data.menuPhone ?? '',
        menuInstagramUrl: venueQuery.data.menuInstagramUrl ?? '',
        menuFacebookUrl: venueQuery.data.menuFacebookUrl ?? '',
        menuWebsiteUrl: venueQuery.data.menuWebsiteUrl ?? '',
        city: venueQuery.data.city ?? '',
        vatNumber: venueQuery.data.vatNumber ?? '',
        timezone: venueQuery.data.timezone ?? 'Europe/Rome',
      });
      setThemeAccentColor(venueQuery.data.themeAccentColor || DEFAULT_ACCENT_COLOR);
    }
  }, [venueQuery.data]);

  const saveOpeningHoursMutation = useMutation({
    mutationFn: async () => (await api.patch('/venues/me/opening-hours', { days: openingHours })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue-me'] });
      showToast('Orari di apertura aggiornati');
    },
    onError: (err) => showToast({ message: extractErrorMessage(err), severity: 'error' }),
  });

  const updateDay = (dayOfWeek: number, patch: Partial<OpeningHoursDay>) => {
    setOpeningHours((days) => days.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  };

  const saveMenuSettingsMutation = useMutation({
    mutationFn: async () => (await api.patch('/venues/me/menu-settings', menuSettings)).data,
    onSuccess: () => {
      menuQueryInvalidate();
      showToast('Aspetto del menù aggiornato');
    },
    onError: (err) => showToast({ message: extractErrorMessage(err), severity: 'error' }),
  });

  const menuQueryInvalidate = () => queryClient.invalidateQueries({ queryKey: ['venue-me'] });

  const saveThemeMutation = useMutation({
    mutationFn: async () =>
      (await api.patch('/venues/me/menu-settings', { themeAccentColor })).data,
    onSuccess: () => {
      menuQueryInvalidate();
      // Applicato subito anche senza aspettare che la query "venue-me" si
      // aggiorni (che comunque avviene, invalidata sopra): evita un attimo
      // col colore vecchio prima del refetch.
      setCachedThemeAccentColor(themeAccentColor);
      showToast('Tema aggiornato');
    },
    onError: (err) => showToast({ message: extractErrorMessage(err), severity: 'error' }),
  });

  const uploadCoverMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('photo', file);
      return (await api.post('/venues/me/menu-cover', form)).data;
    },
    onSuccess: () => {
      menuQueryInvalidate();
      showToast('Copertina aggiornata');
    },
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('photo', file);
      return (await api.post('/venues/me/logo', form)).data;
    },
    onSuccess: () => {
      menuQueryInvalidate();
      showToast('Logo aggiornato');
    },
  });

  const [loyverseToken, setLoyverseToken] = useState('');
  const [loyverseError, setLoyverseError] = useState<string | null>(null);
  const [loyverseLogOpen, setLoyverseLogOpen] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<boolean | null>(null);

  const loyverseStatusQuery = useQuery({
    queryKey: ['loyverse-status'],
    queryFn: async () => (await api.get<LoyverseStatus>('/loyverse/status')).data,
  });

  const loyverseInvalidate = () => queryClient.invalidateQueries({ queryKey: ['loyverse-status'] });

  const toggleLoyverseMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await api.patch('/loyverse/settings', { enabled })).data,
    onSuccess: () => {
      loyverseInvalidate();
      queryClient.invalidateQueries({ queryKey: ['menu-categories'] });
      queryClient.invalidateQueries({ queryKey: ['menu-items'] });
      setLoyverseError(null);
      setPendingToggle(null);
    },
    onError: (err) => {
      showToast({ message: extractErrorMessage(err), severity: 'error' });
      setPendingToggle(null);
    },
  });

  const saveLoyverseTokenMutation = useMutation({
    mutationFn: async () => (await api.patch('/loyverse/settings', { accessToken: loyverseToken })).data,
    onSuccess: () => {
      loyverseInvalidate();
      setLoyverseToken('');
      setLoyverseError(null);
      showToast('Token salvato');
    },
    onError: (err) => setLoyverseError(extractErrorMessage(err)),
  });

  const syncLoyverseMutation = useMutation({
    mutationFn: async () => (await api.post<LoyverseSyncSummary>('/loyverse/sync')).data,
    onSuccess: () => {
      setLoyverseError(null);
      queryClient.invalidateQueries({ queryKey: ['menu-categories'] });
      queryClient.invalidateQueries({ queryKey: ['menu-items'] });
      loyverseInvalidate();
      showToast('Sincronizzazione Loyverse completata');
    },
    onError: (err) => {
      showToast({ message: extractErrorMessage(err), severity: 'error' });
      loyverseInvalidate();
    },
  });

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Orario di apertura
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Giorni di apertura/chiusura e fino a due fasce orarie al giorno: l'orario "reale" in
            cui il locale è fisicamente aperto. Usato dal modulo Prenotazioni e per decidere se un
            ordine online "il prima possibile" può essere confermato subito o deve attendere
            l'apertura. Le fasce pranzo/cena mostrate nel menù pubblico sono invece impostate a
            parte, nella pagina "Impostazioni Menù".
          </Typography>
          <Box sx={{ mt: 2 }}>
            <OpeningHoursWeekEditor days={openingHours} onChangeDay={updateDay} />
          </Box>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={saveOpeningHoursMutation.isPending || openingHours.length === 0}
            onClick={() => saveOpeningHoursMutation.mutate()}
          >
            Salva
          </Button>
          <Button
            sx={{ mt: 2, ml: 1 }}
            startIcon={<EventIcon />}
            onClick={() => navigate('/menu/admin/settings')}
          >
            Fasce pranzo/cena del menù
          </Button>
        </CardContent>
      </Card>

      <SpecialDaysCard />

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Tema
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Colore di accento del tema chiaro: usato nella barra in alto, nei pulsanti e nelle
            icone della navigazione laterale, qui e nell'app installata come PWA sul telefono.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mt: 2 }}>
            {ACCENT_COLOR_PRESETS.map((preset) => (
              <Box
                key={preset.value}
                component="button"
                type="button"
                onClick={() => setThemeAccentColor(preset.value)}
                title={preset.label}
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  bgcolor: preset.value,
                  border: '2px solid',
                  borderColor:
                    themeAccentColor.toLowerCase() === preset.value.toLowerCase() ? 'text.primary' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  p: 0,
                }}
              >
                {themeAccentColor.toLowerCase() === preset.value.toLowerCase() && (
                  <CheckIcon sx={{ color: '#fff', fontSize: 20 }} />
                )}
              </Box>
            ))}
            <Box
              component="label"
              title="Colore personalizzato"
              sx={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                bgcolor: themeAccentColor,
                border: '2px solid',
                borderColor: ACCENT_COLOR_PRESETS.some((p) => p.value.toLowerCase() === themeAccentColor.toLowerCase())
                  ? 'transparent'
                  : 'text.primary',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {!ACCENT_COLOR_PRESETS.some((p) => p.value.toLowerCase() === themeAccentColor.toLowerCase()) && (
                <CheckIcon sx={{ color: '#fff', fontSize: 20 }} />
              )}
              <input
                type="color"
                value={themeAccentColor}
                onChange={(e) => setThemeAccentColor(e.target.value)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer',
                }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              Personalizzato
            </Typography>
          </Box>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={saveThemeMutation.isPending}
            onClick={() => saveThemeMutation.mutate()}
          >
            Salva
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Logo
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Mostrato in alto nelle email di prenotazione inviate ai clienti (distinto dalla
            copertina del menù pubblico qui sotto, pensato per un marchio/logo vero e proprio).
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
            <Avatar variant="rounded" src={venueQuery.data?.logoUrl} sx={{ width: 64, height: 64 }} />
            <Button
              variant="outlined"
              component="label"
              startIcon={<PhotoCameraIcon />}
              disabled={uploadLogoMutation.isPending}
            >
              {venueQuery.data?.logoUrl ? 'Cambia logo' : 'Carica logo'}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogoMutation.mutate(file);
                  e.target.value = '';
                }}
              />
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Aspetto del menù pubblico
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Immagine di copertina mostrata in alto, nome e indirizzo mostrati in fondo insieme ai
            contatti, nel menù che i clienti vedono scansionando il QR code.
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
            <Avatar
              variant="rounded"
              src={venueQuery.data?.menuCoverUrl}
              sx={{ width: 96, height: 64 }}
            />
            <Button
              variant="outlined"
              component="label"
              startIcon={<PhotoCameraIcon />}
              disabled={uploadCoverMutation.isPending}
            >
              {venueQuery.data?.menuCoverUrl ? 'Cambia copertina' : 'Carica copertina'}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadCoverMutation.mutate(file);
                  e.target.value = '';
                }}
              />
            </Button>
          </Box>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, mt: 3, maxWidth: 500 }}>
            <TextField
              label="Nome del locale"
              value={menuSettings.name}
              onChange={(e) => setMenuSettings((s) => ({ ...s, name: e.target.value }))}
              sx={{ gridColumn: '1 / -1' }}
            />
            <TextField
              label="Email del locale"
              type="email"
              helperText="Usata come mittente delle email di ordine ai fornitori."
              value={menuSettings.email}
              onChange={(e) => setMenuSettings((s) => ({ ...s, email: e.target.value }))}
              sx={{ gridColumn: '1 / -1' }}
            />
            <TextField
              label="Indirizzo"
              value={menuSettings.menuAddress}
              onChange={(e) => setMenuSettings((s) => ({ ...s, menuAddress: e.target.value }))}
              sx={{ gridColumn: '1 / -1' }}
            />
            <TextField
              label="Città"
              helperText="Usata nell'intestazione delle email di ordine ai fornitori."
              value={menuSettings.city}
              onChange={(e) => setMenuSettings((s) => ({ ...s, city: e.target.value }))}
            />
            <TextField
              label="Partita IVA"
              helperText="Come sopra, per l'intestazione delle email di ordine ai fornitori."
              value={menuSettings.vatNumber}
              onChange={(e) => setMenuSettings((s) => ({ ...s, vatNumber: e.target.value }))}
            />
            <Autocomplete
              options={timezoneOptions}
              value={menuSettings.timezone}
              disableClearable
              onChange={(_e, value) => setMenuSettings((s) => ({ ...s, timezone: value ?? 'Europe/Rome' }))}
              sx={{ gridColumn: '1 / -1' }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Fuso orario"
                  helperText="Usato per calcolare 'oggi'/l'orario corrente in Prenotazioni, Ordini, HACCP e Pulizie."
                />
              )}
            />
            <TextField
              label="Telefono"
              value={menuSettings.menuPhone}
              onChange={(e) => setMenuSettings((s) => ({ ...s, menuPhone: e.target.value }))}
              sx={{ gridColumn: '1 / -1' }}
            />
            <TextField
              label="Instagram (URL)"
              placeholder="https://instagram.com/..."
              value={menuSettings.menuInstagramUrl}
              onChange={(e) => setMenuSettings((s) => ({ ...s, menuInstagramUrl: e.target.value }))}
              sx={{ gridColumn: '1 / -1' }}
            />
            <TextField
              label="Facebook (URL)"
              placeholder="https://facebook.com/..."
              value={menuSettings.menuFacebookUrl}
              onChange={(e) => setMenuSettings((s) => ({ ...s, menuFacebookUrl: e.target.value }))}
              sx={{ gridColumn: '1 / -1' }}
            />
            <TextField
              label="Sito web (URL)"
              placeholder="https://..."
              value={menuSettings.menuWebsiteUrl}
              onChange={(e) => setMenuSettings((s) => ({ ...s, menuWebsiteUrl: e.target.value }))}
              sx={{ gridColumn: '1 / -1' }}
            />
          </Box>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={saveMenuSettingsMutation.isPending}
            onClick={() => saveMenuSettingsMutation.mutate()}
          >
            Salva
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Integrazione Loyverse
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Quando attiva, categorie, prodotti, prezzi e immagini del menù arrivano da Loyverse:
            qui si gestisce solo cosa mostrare online (visibilità, disponibilità, solo pranzo/cena).
          </Typography>

          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Switch
                checked={loyverseStatusQuery.data?.enabled ?? false}
                disabled={toggleLoyverseMutation.isPending}
                onChange={(e) => setPendingToggle(e.target.checked)}
              />
            }
            label={loyverseStatusQuery.data?.enabled ? 'Integrazione attiva' : 'Integrazione disattivata'}
          />

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mt: 2, maxWidth: 500 }}>
            <TextField
              label={
                loyverseStatusQuery.data?.hasToken
                  ? 'Nuovo token di accesso Loyverse (lascia vuoto per non cambiarlo)'
                  : 'Token di accesso Loyverse'
              }
              type="password"
              fullWidth
              value={loyverseToken}
              onChange={(e) => setLoyverseToken(e.target.value)}
              helperText="Generato dal Back Office Loyverse (Impostazioni > Punti vendita > API token)."
            />
            <Button
              variant="outlined"
              sx={{ flexShrink: 0 }}
              disabled={!loyverseToken || saveLoyverseTokenMutation.isPending}
              onClick={() => saveLoyverseTokenMutation.mutate()}
            >
              Salva token
            </Button>
          </Box>

          {loyverseStatusQuery.data?.lastSyncAt && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              Ultima sincronizzazione: {new Date(loyverseStatusQuery.data.lastSyncAt).toLocaleString('it-IT')}
            </Typography>
          )}
          {loyverseStatusQuery.data?.lastSyncError && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Ultima sincronizzazione non riuscita: {loyverseStatusQuery.data.lastSyncError}
            </Alert>
          )}
          {loyverseError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setLoyverseError(null)}>
              {loyverseError}
            </Alert>
          )}
          {loyverseStatusQuery.data?.lastSyncSummary && (
            <Alert
              severity={loyverseStatusQuery.data.lastSyncSummary.warnings.length > 0 ? 'warning' : 'success'}
              sx={{ mt: 2 }}
            >
              Sincronizzate {loyverseStatusQuery.data.lastSyncSummary.categories} categorie e{' '}
              {loyverseStatusQuery.data.lastSyncSummary.items} voci di menù.
              {loyverseStatusQuery.data.lastSyncSummary.imagesSkipped
                ? ' Nessuna immagine trovata su Loyverse per questi prodotti.'
                : ` ${loyverseStatusQuery.data.lastSyncSummary.imagesDownloaded} nuove immagini scaricate.`}
              {(loyverseStatusQuery.data.lastSyncSummary.categoriesRemoved > 0 ||
                loyverseStatusQuery.data.lastSyncSummary.itemsRemoved > 0) &&
                ` ${loyverseStatusQuery.data.lastSyncSummary.categoriesRemoved} categorie e ${loyverseStatusQuery.data.lastSyncSummary.itemsRemoved} voci rimosse perché non più su Loyverse.`}
              {loyverseStatusQuery.data.lastSyncSummary.warnings.length > 0 &&
                ` ${loyverseStatusQuery.data.lastSyncSummary.warnings.length} voci saltate, vedi il log.`}
            </Alert>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
            <Button
              variant="contained"
              startIcon={syncLoyverseMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
              disabled={!loyverseStatusQuery.data?.enabled || syncLoyverseMutation.isPending}
              onClick={() => syncLoyverseMutation.mutate()}
            >
              {syncLoyverseMutation.isPending ? 'Sincronizzazione in corso…' : 'Sincronizza ora'}
            </Button>
            <Button
              variant="text"
              startIcon={<ArticleIcon />}
              disabled={!loyverseStatusQuery.data?.lastSyncAt}
              onClick={() => setLoyverseLogOpen(true)}
            >
              Vedi log
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Dialog open={loyverseLogOpen} onClose={() => setLoyverseLogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Log ultima sincronizzazione Loyverse</DialogTitle>
        <DialogContent>
          {loyverseStatusQuery.data?.lastSyncAt && (
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {new Date(loyverseStatusQuery.data.lastSyncAt).toLocaleString('it-IT')}
            </Typography>
          )}
          {loyverseStatusQuery.data?.lastSyncError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {loyverseStatusQuery.data.lastSyncError}
            </Alert>
          )}
          {loyverseStatusQuery.data?.lastSyncSummary && (
            <>
              <Typography variant="body2">
                {loyverseStatusQuery.data.lastSyncSummary.categories} categorie,{' '}
                {loyverseStatusQuery.data.lastSyncSummary.items} voci sincronizzate,{' '}
                {loyverseStatusQuery.data.lastSyncSummary.imagesDownloaded} immagini scaricate.
                {(loyverseStatusQuery.data.lastSyncSummary.categoriesRemoved > 0 ||
                  loyverseStatusQuery.data.lastSyncSummary.itemsRemoved > 0) &&
                  ` ${loyverseStatusQuery.data.lastSyncSummary.categoriesRemoved} categorie e ${loyverseStatusQuery.data.lastSyncSummary.itemsRemoved} voci rimosse perché non più su Loyverse.`}
              </Typography>
              {loyverseStatusQuery.data.lastSyncSummary.warnings.length > 0 ? (
                <List dense>
                  {loyverseStatusQuery.data.lastSyncSummary.warnings.map((warning, i) => (
                    <ListItem key={i} disableGutters>
                      <ListItemText primary={warning} />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  Nessuna voce saltata.
                </Typography>
              )}
            </>
          )}
          {!loyverseStatusQuery.data?.lastSyncSummary && !loyverseStatusQuery.data?.lastSyncError && (
            <Typography variant="body2" color="text.secondary">
              Nessuna sincronizzazione completata finora.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setLoyverseLogOpen(false)}>Chiudi</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={pendingToggle !== null}
        title={pendingToggle ? 'Attivare l\'integrazione Loyverse?' : 'Disattivare l\'integrazione Loyverse?'}
        message={
          pendingToggle
            ? 'Categorie e voci di menù attualmente presenti (create a mano) verranno eliminate: da questo momento il menù online arriverà solo da Loyverse. L\'operazione non è reversibile.'
            : 'Categorie e voci di menù sincronizzate da Loyverse verranno eliminate, dato che non saranno più aggiornabili automaticamente. Potrai ricreare il menù a mano. L\'operazione non è reversibile.'
        }
        confirmLabel={pendingToggle ? 'Attiva ed elimina il menù attuale' : 'Disattiva ed elimina il menù'}
        loading={toggleLoyverseMutation.isPending}
        onCancel={() => setPendingToggle(null)}
        onConfirm={() => pendingToggle !== null && toggleLoyverseMutation.mutate(pendingToggle)}
      />
    </Box>
  );
}
