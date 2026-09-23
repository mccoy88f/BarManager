import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import QRCode from 'qrcode';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useToast } from '../../components/ToastProvider';

interface VenueReservationSettings {
  reservationsEnabled: boolean;
  reservationAutoConfirmMaxSeats: number;
  reservationSlotDurationMinutes: number;
  reservationHorizonDays: number;
  reservationOverbookingUnlimited: boolean;
  reservationOverbookingExtraSeats: number;
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
 * Impostazioni del modulo Prenotazioni (§5.7): abilitazione, soglia sopra
 * la quale serve sempre conferma manuale, durata di occupazione di un
 * tavolo (per calcolare le sovrapposizioni) e orizzonte prenotabile dal
 * widget pubblico.
 */
export function ReservationSettings() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [form, setForm] = useState({
    reservationsEnabled: false,
    reservationAutoConfirmMaxSeats: '',
    reservationSlotDurationMinutes: '',
    reservationHorizonDays: '',
    reservationOverbookingUnlimited: false,
    reservationOverbookingExtraSeats: '',
  });

  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<VenueReservationSettings>('/venues/me')).data,
  });

  useEffect(() => {
    if (venueQuery.data) {
      setForm({
        reservationsEnabled: venueQuery.data.reservationsEnabled,
        reservationAutoConfirmMaxSeats: String(venueQuery.data.reservationAutoConfirmMaxSeats),
        reservationSlotDurationMinutes: String(venueQuery.data.reservationSlotDurationMinutes),
        reservationHorizonDays: String(venueQuery.data.reservationHorizonDays),
        reservationOverbookingUnlimited: venueQuery.data.reservationOverbookingUnlimited,
        reservationOverbookingExtraSeats: String(venueQuery.data.reservationOverbookingExtraSeats),
      });
    }
  }, [venueQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch('/venues/me/reservation-settings', {
          reservationsEnabled: form.reservationsEnabled,
          reservationAutoConfirmMaxSeats: Number(form.reservationAutoConfirmMaxSeats),
          reservationSlotDurationMinutes: Number(form.reservationSlotDurationMinutes),
          reservationHorizonDays: Number(form.reservationHorizonDays),
          reservationOverbookingUnlimited: form.reservationOverbookingUnlimited,
          reservationOverbookingExtraSeats: Number(form.reservationOverbookingExtraSeats),
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue-me'] });
      showToast('Impostazioni prenotazioni aggiornate');
    },
    onError: (err) => showToast({ message: extractErrorMessage(err), severity: 'error' }),
  });

  const publicReservationUrl = `${window.location.origin}/prenota`;
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');

  useEffect(() => {
    QRCode.toDataURL(publicReservationUrl, { width: 320, margin: 1 })
      .then(setQrCodeDataUrl)
      .catch(() => setQrCodeDataUrl(''));
  }, [publicReservationUrl]);

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Impostazioni prenotazioni
          </Typography>

          <FormControlLabel
            sx={{ mt: 1, display: 'block' }}
            control={
              <Switch
                checked={form.reservationsEnabled}
                onChange={(e) => setForm((f) => ({ ...f, reservationsEnabled: e.target.checked }))}
              />
            }
            label={form.reservationsEnabled ? 'Prenotazioni online attive' : 'Prenotazioni online disattivate'}
          />

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, mt: 2, maxWidth: 500 }}>
            <TextField
              label="Soglia conferma automatica (posti)"
              type="number"
              helperText="Sopra questo numero di persone, serve sempre conferma manuale."
              value={form.reservationAutoConfirmMaxSeats}
              onChange={(e) => setForm((f) => ({ ...f, reservationAutoConfirmMaxSeats: e.target.value }))}
            />
            <TextField
              label="Durata occupazione tavolo (minuti)"
              type="number"
              helperText="Usata per calcolare le sovrapposizioni fra prenotazioni."
              value={form.reservationSlotDurationMinutes}
              onChange={(e) => setForm((f) => ({ ...f, reservationSlotDurationMinutes: e.target.value }))}
            />
            <TextField
              label="Prenotabile fino a (giorni)"
              type="number"
              helperText="Quanti giorni in avanti si può prenotare dal widget pubblico."
              value={form.reservationHorizonDays}
              onChange={(e) => setForm((f) => ({ ...f, reservationHorizonDays: e.target.value }))}
              sx={{ gridColumn: '1 / -1' }}
            />
          </Box>

          <Typography variant="subtitle2" sx={{ mt: 3 }} gutterBottom>
            Overbooking
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Tolleranza sul blocco automatico del widget pubblico quando le richieste superano la
            capienza dei tavoli attivi. Non riguarda le prenotazioni aggiunte a mano in backoffice,
            che non hanno mai questo vincolo.
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={form.reservationOverbookingUnlimited}
                onChange={(e) =>
                  setForm((f) => ({ ...f, reservationOverbookingUnlimited: e.target.checked }))
                }
              />
            }
            label={
              form.reservationOverbookingUnlimited
                ? 'Overbooking illimitato (il widget non blocca mai per capienza)'
                : 'Overbooking limitato a una soglia di posti extra'
            }
          />
          {!form.reservationOverbookingUnlimited && (
            <TextField
              label="Posti extra tollerati sopra la capienza"
              type="number"
              inputProps={{ min: 0 }}
              helperText="0 = blocco rigido non appena la capienza è superata (comportamento storico)."
              value={form.reservationOverbookingExtraSeats}
              onChange={(e) =>
                setForm((f) => ({ ...f, reservationOverbookingExtraSeats: e.target.value }))
              }
              sx={{ mt: 1, maxWidth: 300, display: 'block' }}
            />
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

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Link e QR code del widget di prenotazione
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            I clienti possono prenotare, senza login, a questo indirizzo o scansionando il QR code.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems="center" sx={{ mt: 2 }}>
            <Stack spacing={1} sx={{ flexGrow: 1, width: '100%' }}>
              <TextField
                label="URL prenotazioni pubbliche"
                value={publicReservationUrl}
                size="small"
                InputProps={{ readOnly: true }}
                onFocus={(e) => e.target.select()}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() =>
                    navigator.clipboard
                      ?.writeText(publicReservationUrl)
                      .then(() => showToast('Link copiato'))
                  }
                >
                  Copia link
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  component="a"
                  href={publicReservationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Apri link
                </Button>
              </Stack>
            </Stack>
            {qrCodeDataUrl && (
              <Stack spacing={1} alignItems="center">
                <Box
                  component="img"
                  src={qrCodeDataUrl}
                  alt="QR code prenotazioni"
                  sx={{ width: 160, height: 160 }}
                />
                <Button
                  variant="contained"
                  size="small"
                  component="a"
                  href={qrCodeDataUrl}
                  download="prenotazioni-qrcode.png"
                >
                  Scarica QR code
                </Button>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
