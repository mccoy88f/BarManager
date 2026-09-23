import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../../api/client';

interface ReservationInfo {
  name: string;
  reservationHorizonDays: number;
  lunchStart: string;
  lunchEnd: string;
  dinnerStart: string;
  dinnerEnd: string;
}

const initialForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  partySize: '2',
  date: '',
  time: '',
  isEvent: false,
  eventNote: '',
  allergiesNote: '',
  notes: '',
};

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Non è stato possibile inviare la richiesta. Riprova più tardi.';
}

/**
 * Widget pubblico di prenotazione (§5.7), nessun login: raggiunto dal link
 * o dal QR code condiviso dal locale. In sviluppo locale (senza
 * sotto-domini) si può forzare il locale con "?venueSlug=demo" nell'URL,
 * come per il menù pubblico.
 */
export function PublicReservation() {
  const params = new URLSearchParams(window.location.search);
  const venueSlug = params.get('venueSlug');
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState<'CONFIRMED' | 'PENDING' | null>(null);

  const infoQuery = useQuery({
    queryKey: ['public-reservation-info', venueSlug],
    queryFn: async () =>
      (
        await api.get<ReservationInfo>('/public/reservations/info', {
          params: venueSlug ? { venueSlug } : undefined,
        })
      ).data,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const reservedAt = new Date(`${form.date}T${form.time}:00`).toISOString();
      return (
        await api.post<{ status: 'CONFIRMED' | 'PENDING' }>(
          '/public/reservations',
          {
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
            partySize: Number(form.partySize),
            reservedAt,
            isEvent: form.isEvent,
            eventNote: form.isEvent ? form.eventNote.trim() : undefined,
            allergiesNote: form.allergiesNote.trim() || undefined,
            notes: form.notes.trim() || undefined,
          },
          { params: venueSlug ? { venueSlug } : undefined },
        )
      ).data;
    },
    onSuccess: (data) => setResult(data.status),
  });

  if (infoQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (infoQuery.isError || !infoQuery.data) {
    return (
      <Box sx={{ textAlign: 'center', mt: 6 }}>
        <Typography>Prenotazioni non disponibili per questo locale.</Typography>
      </Box>
    );
  }

  const { name, reservationHorizonDays, lunchStart, lunchEnd, dinnerStart, dinnerEnd } = infoQuery.data;
  const today = new Date().toISOString().slice(0, 10);
  const maxDate = new Date(Date.now() + reservationHorizonDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const canSubmit =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.email.trim() &&
    form.phone.trim() &&
    form.date &&
    form.time &&
    Number(form.partySize) > 0 &&
    (!form.isEvent || form.eventNote.trim());

  if (result) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 6, px: 2 }}>
        <Alert severity={result === 'CONFIRMED' ? 'success' : 'info'}>
          {result === 'CONFIRMED'
            ? `Prenotazione confermata! Riceverai una email di conferma a ${form.email}.`
            : `Richiesta ricevuta. Ti confermeremo a breve la disponibilità via email a ${form.email}.`}
        </Alert>
        <Button sx={{ mt: 2 }} onClick={() => { setForm(initialForm); setResult(null); }}>
          Nuova prenotazione
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, py: 4 }}>
      <Typography variant="h5" fontWeight={700} textAlign="center" gutterBottom>
        Prenota un tavolo — {name}
      </Typography>
      <Typography variant="body2" color="text.secondary" textAlign="center" gutterBottom>
        Orari disponibili: pranzo {lunchStart}–{lunchEnd}, cena {dinnerStart}–{dinnerEnd}.
      </Typography>

      <Card variant="outlined" sx={{ mt: 3 }}>
        <CardContent sx={{ display: 'grid', gap: 2 }}>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Nome"
              fullWidth
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
            <TextField
              label="Cognome"
              fullWidth
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
          </Stack>
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <TextField
            label="Telefono"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Data"
              type="date"
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: today, max: maxDate }}
              fullWidth
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
            <TextField
              label="Orario"
              type="time"
              InputLabelProps={{ shrink: true }}
              fullWidth
              value={form.time}
              onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
            />
          </Stack>
          <TextField
            label="Numero di persone"
            type="number"
            inputProps={{ min: 1 }}
            value={form.partySize}
            onChange={(e) => setForm((f) => ({ ...f, partySize: e.target.value }))}
          />

          <FormControlLabel
            control={
              <Switch
                checked={form.isEvent}
                onChange={(e) => setForm((f) => ({ ...f, isEvent: e.target.checked }))}
              />
            }
            label="È per un'occasione speciale (es. compleanno)"
          />
          {form.isEvent && (
            <TextField
              label="Descrivi l'occasione"
              placeholder="es. Compleanno"
              value={form.eventNote}
              onChange={(e) => setForm((f) => ({ ...f, eventNote: e.target.value }))}
            />
          )}

          <TextField
            label="Intolleranze o allergie (opzionale)"
            multiline
            minRows={2}
            value={form.allergiesNote}
            onChange={(e) => setForm((f) => ({ ...f, allergiesNote: e.target.value }))}
          />
          <TextField
            label="Altre note (opzionale)"
            multiline
            minRows={2}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />

          {submitMutation.isError && (
            <Alert severity="error">{extractErrorMessage(submitMutation.error)}</Alert>
          )}

          <Button
            variant="contained"
            size="large"
            disabled={!canSubmit || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? 'Invio in corso…' : 'Prenota'}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
