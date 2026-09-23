import { useEffect, useState } from 'react';
import {
  Alert,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

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
  lunchStart: string;
  lunchEnd: string;
  dinnerStart: string;
  dinnerEnd: string;
  menuCoverUrl?: string;
  menuAddress?: string;
  menuPhone?: string;
  menuInstagramUrl?: string;
  menuFacebookUrl?: string;
  menuWebsiteUrl?: string;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Fasce orarie pranzo/cena del locale: determinano quali voci di menù sono
 * mostrate come disponibili nel menù pubblico in base all'ora corrente. */
export function VenueSettings() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [hours, setHours] = useState({
    lunchStart: '',
    lunchEnd: '',
    dinnerStart: '',
    dinnerEnd: '',
  });

  const [menuSettings, setMenuSettings] = useState({
    name: '',
    email: '',
    menuAddress: '',
    menuPhone: '',
    menuInstagramUrl: '',
    menuFacebookUrl: '',
    menuWebsiteUrl: '',
  });

  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<VenueHours>('/venues/me')).data,
  });

  useEffect(() => {
    if (venueQuery.data) {
      setHours({
        lunchStart: venueQuery.data.lunchStart,
        lunchEnd: venueQuery.data.lunchEnd,
        dinnerStart: venueQuery.data.dinnerStart,
        dinnerEnd: venueQuery.data.dinnerEnd,
      });
      setMenuSettings({
        name: venueQuery.data.name ?? '',
        email: venueQuery.data.email ?? '',
        menuAddress: venueQuery.data.menuAddress ?? '',
        menuPhone: venueQuery.data.menuPhone ?? '',
        menuInstagramUrl: venueQuery.data.menuInstagramUrl ?? '',
        menuFacebookUrl: venueQuery.data.menuFacebookUrl ?? '',
        menuWebsiteUrl: venueQuery.data.menuWebsiteUrl ?? '',
      });
    }
  }, [venueQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => (await api.patch('/venues/me/hours', hours)).data,
    onSuccess: () => showToast('Fasce orarie aggiornate'),
    onError: (err) => showToast({ message: extractErrorMessage(err), severity: 'error' }),
  });

  const saveMenuSettingsMutation = useMutation({
    mutationFn: async () => (await api.patch('/venues/me/menu-settings', menuSettings)).data,
    onSuccess: () => {
      menuQueryInvalidate();
      showToast('Aspetto del menù aggiornato');
    },
    onError: (err) => showToast({ message: extractErrorMessage(err), severity: 'error' }),
  });

  const menuQueryInvalidate = () => queryClient.invalidateQueries({ queryKey: ['venue-me'] });

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
            Fasce orarie del menù
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Determinano quali voci "Solo pranzo"/"Solo cena" sono mostrate come disponibili nel
            menù pubblico in base all'ora corrente.
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, maxWidth: 400 }}>
            <TextField
              label="Inizio pranzo"
              type="time"
              InputLabelProps={{ shrink: true }}
              value={hours.lunchStart}
              onChange={(e) => setHours((h) => ({ ...h, lunchStart: e.target.value }))}
            />
            <TextField
              label="Fine pranzo"
              type="time"
              InputLabelProps={{ shrink: true }}
              value={hours.lunchEnd}
              onChange={(e) => setHours((h) => ({ ...h, lunchEnd: e.target.value }))}
            />
            <TextField
              label="Inizio cena"
              type="time"
              InputLabelProps={{ shrink: true }}
              value={hours.dinnerStart}
              onChange={(e) => setHours((h) => ({ ...h, dinnerStart: e.target.value }))}
            />
            <TextField
              label="Fine cena"
              type="time"
              InputLabelProps={{ shrink: true }}
              value={hours.dinnerEnd}
              onChange={(e) => setHours((h) => ({ ...h, dinnerEnd: e.target.value }))}
            />
          </Box>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            Salva
          </Button>
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
