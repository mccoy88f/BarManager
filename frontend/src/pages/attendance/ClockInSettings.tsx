import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { Link as RouterLink } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

interface VenueClockInSettings {
  clockInQrEnabled: boolean;
  clockInGpsEnabled: boolean;
  clockInNfcEnabled: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsRadiusMeters: number;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/**
 * Metodi di timbratura verificata: l'admin può abilitarne più di uno insieme
 * (QR di postazione, GPS entro un raggio dal locale, tag NFC fisico).
 */
export function ClockInSettings() {
  const queryClient = useQueryClient();

  const [methods, setMethods] = useState({
    clockInQrEnabled: true,
    clockInGpsEnabled: false,
    clockInNfcEnabled: false,
  });
  const [gpsRadius, setGpsRadius] = useState('20');
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [gpsCaptureError, setGpsCaptureError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<VenueClockInSettings>('/venues/me')).data,
  });

  useEffect(() => {
    if (venueQuery.data) {
      setMethods({
        clockInQrEnabled: venueQuery.data.clockInQrEnabled,
        clockInGpsEnabled: venueQuery.data.clockInGpsEnabled,
        clockInNfcEnabled: venueQuery.data.clockInNfcEnabled,
      });
      setGpsRadius(String(venueQuery.data.gpsRadiusMeters));
      setGpsLat(venueQuery.data.gpsLat);
      setGpsLng(venueQuery.data.gpsLng);
    }
  }, [venueQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch('/venues/me/clock-in-settings', {
          ...methods,
          gpsRadiusMeters: Number(gpsRadius),
          ...(gpsLat !== null ? { gpsLat } : {}),
          ...(gpsLng !== null ? { gpsLng } : {}),
        })
      ).data,
    onSuccess: () => {
      setSaveError(null);
      setSaveSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['venue-me'] });
    },
    onError: (err) => {
      setSaveSuccess(false);
      setSaveError(extractErrorMessage(err));
    },
  });

  const captureLocation = () => {
    setGpsCaptureError(null);
    if (!navigator.geolocation) {
      setGpsCaptureError('Il browser non supporta la geolocalizzazione.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsLat(position.coords.latitude);
        setGpsLng(position.coords.longitude);
      },
      () => setGpsCaptureError('Posizione non disponibile: verifica i permessi del browser.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Metodi di timbratura verificata
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Puoi abilitare più di un metodo insieme: il dipendente potrà timbrare con uno
            qualsiasi di quelli attivi. Se nessuno è abilitato, resta disponibile la timbratura
            diretta senza verifica.
          </Typography>

          <Stack spacing={2} sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="subtitle2">QR di postazione</Typography>
                <Typography variant="caption" color="text.secondary">
                  Il dipendente inquadra un QR affisso nel locale.{' '}
                  <MuiLinkTo to="/attendance/qr-tokens" label="Gestisci i codici QR" />
                </Typography>
              </Box>
              <Switch
                checked={methods.clockInQrEnabled}
                onChange={(e) => setMethods((m) => ({ ...m, clockInQrEnabled: e.target.checked }))}
              />
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="subtitle2">Posizione GPS</Typography>
                <Typography variant="caption" color="text.secondary">
                  Il dipendente deve trovarsi entro il raggio impostato dal locale.
                </Typography>
              </Box>
              <Switch
                checked={methods.clockInGpsEnabled}
                onChange={(e) => setMethods((m) => ({ ...m, clockInGpsEnabled: e.target.checked }))}
              />
            </Box>

            {methods.clockInGpsEnabled && (
              <Box sx={{ pl: 2, borderLeft: '2px solid', borderColor: 'divider' }}>
                <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<MyLocationIcon />}
                    onClick={captureLocation}
                  >
                    Usa la mia posizione attuale
                  </Button>
                  <TextField
                    label="Raggio (metri)"
                    type="number"
                    size="small"
                    value={gpsRadius}
                    onChange={(e) => setGpsRadius(e.target.value)}
                    sx={{ width: 140 }}
                  />
                  {gpsLat !== null && gpsLng !== null ? (
                    <Chip
                      size="small"
                      color="success"
                      label={`Posizione impostata (${gpsLat.toFixed(5)}, ${gpsLng.toFixed(5)})`}
                    />
                  ) : (
                    <Chip size="small" color="warning" label="Posizione non ancora impostata" />
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Vai fisicamente al locale prima di premere il pulsante, così la posizione
                  catturata è quella corretta.
                </Typography>
                {gpsCaptureError && (
                  <Alert severity="error" sx={{ mt: 1 }} onClose={() => setGpsCaptureError(null)}>
                    {gpsCaptureError}
                  </Alert>
                )}
              </Box>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="subtitle2">Tag NFC</Typography>
                <Typography variant="caption" color="text.secondary">
                  Il dipendente avvicina il telefono a un tag NFC fisico presente nel locale.{' '}
                  <MuiLinkTo to="/attendance/nfc-tags" label="Gestisci i tag NFC" />
                </Typography>
              </Box>
              <Switch
                checked={methods.clockInNfcEnabled}
                onChange={(e) => setMethods((m) => ({ ...m, clockInNfcEnabled: e.target.checked }))}
              />
            </Box>
          </Stack>

          {saveError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setSaveError(null)}>
              {saveError}
            </Alert>
          )}
          {saveSuccess && (
            <Alert severity="success" sx={{ mt: 2 }} onClose={() => setSaveSuccess(false)}>
              Impostazioni salvate.
            </Alert>
          )}
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
    </Box>
  );
}

function MuiLinkTo({ to, label }: { to: string; label: string }) {
  return (
    <RouterLink to={to} style={{ color: 'inherit' }}>
      {label}
    </RouterLink>
  );
}
