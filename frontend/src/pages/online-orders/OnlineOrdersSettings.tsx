import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useToast } from '../../components/ToastProvider';
import { SUCCESS_CHIP_COLOR, NEUTRAL_CHIP_COLOR } from '../../config/statusChip';
import { OpeningHoursWeekEditor, type OpeningHoursDay } from '../../components/OpeningHoursWeekEditor';

type SlotMode = 'COMBINED' | 'SEPARATE';

interface VenueOnlineOrdersSettings {
  onlineOrdersEnabled: boolean;
  onlineOrdersPickupEnabled: boolean;
  onlineOrdersDeliveryEnabled: boolean;
  onlineOrdersOpeningHours: OpeningHoursDay[] | null;
  openingHours: OpeningHoursDay[];
  onlineOrdersMinLeadMinutes: number;
  onlineOrdersAutoAcceptEnabled: boolean;
  onlineOrdersAutoAcceptSlotMode: SlotMode;
  onlineOrdersAutoAcceptPerSlot: number;
  onlineOrdersAutoAcceptPerSlotPickup: number;
  onlineOrdersAutoAcceptPerSlotDelivery: number;
  deliveryRadiusMeters: number | null;
  deliveryFee: number;
  deliveryFreeAboveAmount: number | null;
  sumupEnabled: boolean;
  sumupHasApiKey: boolean;
  loyverseIntegrationEnabled: boolean;
  loyversePaymentTypeIdCash: string | null;
  loyversePaymentTypeIdCardOnline: string | null;
  loyversePaymentTypeIdCardInStore: string | null;
}

interface LoyversePaymentType {
  id: string;
  name: string;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/**
 * Impostazioni del modulo Ordini online (§5.10 di DEVELOPMENT.md): stesso
 * schema a Card sempre visibili di VenueSettings.tsx, un salvataggio per
 * sezione invece di un unico submit globale.
 */
export function OnlineOrdersSettings() {
  const queryClient = useQueryClient();
  const showToast = useToast();

  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<VenueOnlineOrdersSettings>('/venues/me')).data,
  });

  const [general, setGeneral] = useState({
    onlineOrdersEnabled: false,
    onlineOrdersPickupEnabled: true,
    onlineOrdersDeliveryEnabled: true,
    onlineOrdersMinLeadMinutes: '30',
  });
  const [openingHours, setOpeningHours] = useState<OpeningHoursDay[]>([]);
  const [delivery, setDelivery] = useState({ deliveryRadiusMeters: '', deliveryFee: '0', deliveryFreeAboveAmount: '' });
  const [autoAccept, setAutoAccept] = useState({
    onlineOrdersAutoAcceptEnabled: false,
    onlineOrdersAutoAcceptSlotMode: 'COMBINED' as SlotMode,
    onlineOrdersAutoAcceptPerSlot: '0',
    onlineOrdersAutoAcceptPerSlotPickup: '0',
    onlineOrdersAutoAcceptPerSlotDelivery: '0',
  });
  const [sumupEnabled, setSumupEnabled] = useState(false);
  const [sumupApiKey, setSumupApiKey] = useState('');
  const [loyversePaymentTypes, setLoyversePaymentTypes] = useState<LoyversePaymentType[] | null>(null);
  const [loyverseMapping, setLoyverseMapping] = useState({ cash: '', cardOnline: '', cardInStore: '' });

  useEffect(() => {
    if (!venueQuery.data) return;
    const v = venueQuery.data;
    setGeneral({
      onlineOrdersEnabled: v.onlineOrdersEnabled,
      onlineOrdersPickupEnabled: v.onlineOrdersPickupEnabled,
      onlineOrdersDeliveryEnabled: v.onlineOrdersDeliveryEnabled,
      onlineOrdersMinLeadMinutes: String(v.onlineOrdersMinLeadMinutes),
    });
    setOpeningHours(v.onlineOrdersOpeningHours ?? v.openingHours);
    setDelivery({
      deliveryRadiusMeters: v.deliveryRadiusMeters != null ? String(v.deliveryRadiusMeters) : '',
      deliveryFee: String(v.deliveryFee),
      deliveryFreeAboveAmount: v.deliveryFreeAboveAmount != null ? String(v.deliveryFreeAboveAmount) : '',
    });
    setAutoAccept({
      onlineOrdersAutoAcceptEnabled: v.onlineOrdersAutoAcceptEnabled,
      onlineOrdersAutoAcceptSlotMode: v.onlineOrdersAutoAcceptSlotMode,
      onlineOrdersAutoAcceptPerSlot: String(v.onlineOrdersAutoAcceptPerSlot),
      onlineOrdersAutoAcceptPerSlotPickup: String(v.onlineOrdersAutoAcceptPerSlotPickup),
      onlineOrdersAutoAcceptPerSlotDelivery: String(v.onlineOrdersAutoAcceptPerSlotDelivery),
    });
    setSumupEnabled(v.sumupEnabled);
    setLoyverseMapping({
      cash: v.loyversePaymentTypeIdCash ?? '',
      cardOnline: v.loyversePaymentTypeIdCardOnline ?? '',
      cardInStore: v.loyversePaymentTypeIdCardInStore ?? '',
    });
  }, [venueQuery.data]);

  const invalidateVenue = () => queryClient.invalidateQueries({ queryKey: ['venue-me'] });

  const saveGeneralMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch('/venues/me/online-orders-settings', {
          onlineOrdersEnabled: general.onlineOrdersEnabled,
          onlineOrdersPickupEnabled: general.onlineOrdersPickupEnabled,
          onlineOrdersDeliveryEnabled: general.onlineOrdersDeliveryEnabled,
          onlineOrdersMinLeadMinutes: Number(general.onlineOrdersMinLeadMinutes),
        })
      ).data,
    onSuccess: () => { invalidateVenue(); showToast('Impostazioni generali salvate'); },
  });

  const updateDay = (dayOfWeek: number, patch: Partial<OpeningHoursDay>) => {
    setOpeningHours((days) => days.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  };
  const saveOpeningHoursMutation = useMutation({
    mutationFn: async () => (await api.patch('/venues/me/online-orders-opening-hours', { days: openingHours })).data,
    onSuccess: () => { invalidateVenue(); showToast('Orari ordini online salvati'); },
  });

  const saveDeliveryMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch('/venues/me/online-orders-settings', {
          deliveryRadiusMeters: delivery.deliveryRadiusMeters ? Number(delivery.deliveryRadiusMeters) : null,
          deliveryFee: Number(delivery.deliveryFee),
          deliveryFreeAboveAmount: delivery.deliveryFreeAboveAmount ? Number(delivery.deliveryFreeAboveAmount) : null,
        })
      ).data,
    onSuccess: () => { invalidateVenue(); showToast('Impostazioni di consegna salvate'); },
  });

  const saveAutoAcceptMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch('/venues/me/online-orders-settings', {
          onlineOrdersAutoAcceptEnabled: autoAccept.onlineOrdersAutoAcceptEnabled,
          onlineOrdersAutoAcceptSlotMode: autoAccept.onlineOrdersAutoAcceptSlotMode,
          onlineOrdersAutoAcceptPerSlot: Number(autoAccept.onlineOrdersAutoAcceptPerSlot),
          onlineOrdersAutoAcceptPerSlotPickup: Number(autoAccept.onlineOrdersAutoAcceptPerSlotPickup),
          onlineOrdersAutoAcceptPerSlotDelivery: Number(autoAccept.onlineOrdersAutoAcceptPerSlotDelivery),
        })
      ).data,
    onSuccess: () => { invalidateVenue(); showToast('Accettazione automatica salvata'); },
  });

  const saveSumupSettingsMutation = useMutation({
    mutationFn: async () =>
      (await api.patch('/venues/me/sumup-settings', { enabled: sumupEnabled, apiKey: sumupApiKey || undefined })).data,
    onSuccess: () => { invalidateVenue(); setSumupApiKey(''); showToast('Credenziali SumUp salvate'); },
  });

  const verifyApiKeyMutation = useMutation({
    mutationFn: async () => (await api.post('/venues/me/sumup-verify-key')).data,
    onSuccess: () => showToast('API key SumUp valida: funziona correttamente'),
  });

  const fetchLoyversePaymentTypesMutation = useMutation({
    mutationFn: async () => (await api.get<LoyversePaymentType[]>('/venues/me/loyverse-payment-types')).data,
    onSuccess: (types) => {
      setLoyversePaymentTypes(types);
      showToast(types.length ? `${types.length} metodi Loyverse letti` : 'Nessun metodo di pagamento configurato su Loyverse');
    },
  });

  const saveLoyverseMappingMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch('/venues/me/online-orders-settings', {
          loyversePaymentTypeIdCash: loyverseMapping.cash || null,
          loyversePaymentTypeIdCardOnline: loyverseMapping.cardOnline || null,
          loyversePaymentTypeIdCardInStore: loyverseMapping.cardInStore || null,
        })
      ).data,
    onSuccess: () => { invalidateVenue(); showToast('Mappatura Loyverse salvata'); },
  });

  if (venueQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Typography variant="h6">Impostazioni ordini online</Typography>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Interruttori generali
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={general.onlineOrdersEnabled}
                onChange={(e) => setGeneral((f) => ({ ...f, onlineOrdersEnabled: e.target.checked }))}
              />
            }
            label="Ordini online attivi"
          />
          <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={general.onlineOrdersPickupEnabled}
                  onChange={(e) => setGeneral((f) => ({ ...f, onlineOrdersPickupEnabled: e.target.checked }))}
                />
              }
              label="Ritiro in negozio"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={general.onlineOrdersDeliveryEnabled}
                  onChange={(e) => setGeneral((f) => ({ ...f, onlineOrdersDeliveryEnabled: e.target.checked }))}
                />
              }
              label="Consegna a domicilio"
            />
          </Stack>
          <TextField
            label="Anticipo minimo (minuti da adesso)"
            type="number"
            size="small"
            sx={{ mt: 2, maxWidth: 300 }}
            inputProps={{ min: 0 }}
            value={general.onlineOrdersMinLeadMinutes}
            onChange={(e) => setGeneral((f) => ({ ...f, onlineOrdersMinLeadMinutes: e.target.value }))}
          />
          <Box>
            <Button
              variant="contained"
              sx={{ mt: 2 }}
              disabled={saveGeneralMutation.isPending}
              onClick={() => saveGeneralMutation.mutate()}
            >
              Salva
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Orari ordini online
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Se non ancora personalizzati, qui sono mostrati gli stessi orari generali del locale.
            Il primo/ultimo orario richiedibile dal cliente è comunque sempre ristretto di 30 minuti
            su ciascun lato della fascia (margine fisso di preparazione, non modificabile qui).
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
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Zona e costo di consegna
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <TextField
              label="Raggio massimo (metri, vuoto = nessun limite)"
              type="number"
              size="small"
              inputProps={{ min: 1 }}
              value={delivery.deliveryRadiusMeters}
              onChange={(e) => setDelivery((f) => ({ ...f, deliveryRadiusMeters: e.target.value }))}
              sx={{ flex: '1 1 220px' }}
            />
            <TextField
              label="Costo di consegna (€)"
              type="number"
              size="small"
              inputProps={{ min: 0, step: 0.5 }}
              value={delivery.deliveryFee}
              onChange={(e) => setDelivery((f) => ({ ...f, deliveryFee: e.target.value }))}
              sx={{ flex: '1 1 220px' }}
            />
            <TextField
              label="Consegna gratuita sopra (€, vuoto = mai gratuita)"
              type="number"
              size="small"
              inputProps={{ min: 0 }}
              value={delivery.deliveryFreeAboveAmount}
              onChange={(e) => setDelivery((f) => ({ ...f, deliveryFreeAboveAmount: e.target.value }))}
              sx={{ flex: '1 1 220px' }}
            />
          </Box>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={saveDeliveryMutation.isPending}
            onClick={() => saveDeliveryMutation.mutate()}
          >
            Salva
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Accettazione automatica per fascia da 15 minuti
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Non blocca mai l'invio dell'ordine: decide solo se un ordine sotto soglia nasce già
            confermato, saltando la revisione manuale.
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={autoAccept.onlineOrdersAutoAcceptEnabled}
                onChange={(e) => setAutoAccept((f) => ({ ...f, onlineOrdersAutoAcceptEnabled: e.target.checked }))}
              />
            }
            label="Accettazione automatica attiva"
          />
          {autoAccept.onlineOrdersAutoAcceptEnabled && (
            <Box sx={{ mt: 1, display: 'grid', gap: 1.5 }}>
              <TextField
                select
                label="Contatore"
                size="small"
                sx={{ maxWidth: 320 }}
                value={autoAccept.onlineOrdersAutoAcceptSlotMode}
                onChange={(e) => setAutoAccept((f) => ({ ...f, onlineOrdersAutoAcceptSlotMode: e.target.value as SlotMode }))}
              >
                <MenuItem value="COMBINED">Unico (ritiro + consegna insieme)</MenuItem>
                <MenuItem value="SEPARATE">Separato per modalità</MenuItem>
              </TextField>
              {autoAccept.onlineOrdersAutoAcceptSlotMode === 'COMBINED' ? (
                <TextField
                  label="Ordini per fascia"
                  type="number"
                  size="small"
                  sx={{ maxWidth: 220 }}
                  inputProps={{ min: 0 }}
                  value={autoAccept.onlineOrdersAutoAcceptPerSlot}
                  onChange={(e) => setAutoAccept((f) => ({ ...f, onlineOrdersAutoAcceptPerSlot: e.target.value }))}
                />
              ) : (
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Ordini per fascia — ritiro"
                    type="number"
                    size="small"
                    inputProps={{ min: 0 }}
                    value={autoAccept.onlineOrdersAutoAcceptPerSlotPickup}
                    onChange={(e) => setAutoAccept((f) => ({ ...f, onlineOrdersAutoAcceptPerSlotPickup: e.target.value }))}
                  />
                  <TextField
                    label="Ordini per fascia — consegna"
                    type="number"
                    size="small"
                    inputProps={{ min: 0 }}
                    value={autoAccept.onlineOrdersAutoAcceptPerSlotDelivery}
                    onChange={(e) => setAutoAccept((f) => ({ ...f, onlineOrdersAutoAcceptPerSlotDelivery: e.target.value }))}
                  />
                </Stack>
              )}
            </Box>
          )}
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={saveAutoAcceptMutation.isPending}
            onClick={() => saveAutoAcceptMutation.mutate()}
          >
            Salva
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            SumUp — pagamento con carta online (solo consegna)
          </Typography>
          <FormControlLabel
            control={<Switch checked={sumupEnabled} onChange={(e) => setSumupEnabled(e.target.checked)} />}
            label={sumupEnabled ? 'Integrazione attiva' : 'Integrazione disattivata'}
          />
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mt: 2, maxWidth: 500 }}>
            <TextField
              label={venueQuery.data?.sumupHasApiKey ? 'Nuova API key (lascia vuoto per non cambiarla)' : 'API key SumUp'}
              type="password"
              fullWidth
              size="small"
              value={sumupApiKey}
              onChange={(e) => setSumupApiKey(e.target.value)}
              helperText="Generata dal Dashboard SumUp -> Developer Settings"
            />
          </Box>
          <Button
            variant="outlined"
            sx={{ mt: 2 }}
            disabled={(!sumupApiKey && sumupEnabled === venueQuery.data?.sumupEnabled) || saveSumupSettingsMutation.isPending}
            onClick={() => saveSumupSettingsMutation.mutate()}
          >
            Salva
          </Button>
          {saveSumupSettingsMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>{extractErrorMessage(saveSumupSettingsMutation.error)}</Alert>
          )}

          <Box sx={{ mt: 3 }}>
            <Button
              variant="contained"
              startIcon={verifyApiKeyMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
              disabled={!venueQuery.data?.sumupHasApiKey || verifyApiKeyMutation.isPending}
              onClick={() => verifyApiKeyMutation.mutate()}
            >
              Verifica API key
            </Button>
            {verifyApiKeyMutation.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>{extractErrorMessage(verifyApiKeyMutation.error)}</Alert>
            )}
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="h6">Loyverse — sincronizzazione ordini online</Typography>
            <Chip
              size="small"
              color={venueQuery.data?.loyverseIntegrationEnabled ? SUCCESS_CHIP_COLOR : NEUTRAL_CHIP_COLOR}
              label={venueQuery.data?.loyverseIntegrationEnabled ? 'Integrazione Loyverse attiva' : 'Integrazione Loyverse non attiva'}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mt: 1 }}>
            Alla chiusura effettiva dell'ordine, se l'integrazione Loyverse è attiva (Impostazioni
            locale), crea automaticamente una ricevuta su Loyverse — nessun interruttore separato
            qui: segue sempre lo stato dell'integrazione generale.
          </Typography>

          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Mappatura metodi di pagamento
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              In Loyverse è il locale stesso a creare i propri metodi di pagamento: accoppia qui
              ciascuno dei metodi di BarManager alla voce Loyverse corrispondente.
            </Typography>
            <Button
              variant="outlined"
              startIcon={fetchLoyversePaymentTypesMutation.isPending ? <CircularProgress size={16} /> : <SyncIcon />}
              disabled={!venueQuery.data?.loyverseIntegrationEnabled || fetchLoyversePaymentTypesMutation.isPending}
              onClick={() => fetchLoyversePaymentTypesMutation.mutate()}
            >
              Leggi metodi Loyverse
            </Button>
            {!venueQuery.data?.loyverseIntegrationEnabled && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Attiva prima l'integrazione Loyverse in Impostazioni locale.
              </Typography>
            )}
            {fetchLoyversePaymentTypesMutation.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>{extractErrorMessage(fetchLoyversePaymentTypesMutation.error)}</Alert>
            )}
            {loyversePaymentTypes && (
              <Stack spacing={2} sx={{ mt: 2, maxWidth: 400 }}>
                <TextField
                  select
                  label="Contanti (CASH)"
                  size="small"
                  value={loyverseMapping.cash}
                  onChange={(e) => setLoyverseMapping((f) => ({ ...f, cash: e.target.value }))}
                >
                  <MenuItem value="">— Non accoppiato —</MenuItem>
                  {loyversePaymentTypes.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Carta online (CARD_ONLINE, via SumUp)"
                  size="small"
                  value={loyverseMapping.cardOnline}
                  onChange={(e) => setLoyverseMapping((f) => ({ ...f, cardOnline: e.target.value }))}
                >
                  <MenuItem value="">— Non accoppiato —</MenuItem>
                  {loyversePaymentTypes.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Carta in negozio (CARD_IN_STORE, ritiro)"
                  size="small"
                  value={loyverseMapping.cardInStore}
                  onChange={(e) => setLoyverseMapping((f) => ({ ...f, cardInStore: e.target.value }))}
                >
                  <MenuItem value="">— Non accoppiato —</MenuItem>
                  {loyversePaymentTypes.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                  ))}
                </TextField>
              </Stack>
            )}
          </Box>

          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={saveLoyverseMappingMutation.isPending}
            onClick={() => saveLoyverseMappingMutation.mutate()}
          >
            Salva
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
