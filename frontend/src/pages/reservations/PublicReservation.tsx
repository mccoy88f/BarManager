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
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import InstagramIcon from '@mui/icons-material/Instagram';
import FacebookIcon from '@mui/icons-material/Facebook';
import LanguageIcon from '@mui/icons-material/Language';
import { api } from '../../api/client';
import { QuarterHourTimeField } from '../../components/QuarterHourTimeField';

interface OpeningHoursDay {
  /** 0 = domenica .. 6 = sabato, come Date#getDay(). */
  dayOfWeek: number;
  closed: boolean;
  slot1Start: string | null;
  slot1End: string | null;
  slot2Start: string | null;
  slot2End: string | null;
}

interface ReservationInfo {
  name: string;
  reservationHorizonDays: number;
  openingHours: OpeningHoursDay[];
  menuAddress?: string;
  city?: string;
  menuPhone?: string;
  menuInstagramUrl?: string;
  menuFacebookUrl?: string;
  menuWebsiteUrl?: string;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Orari selezionabili ai 15 minuti per il giorno indicato (entrambe le
 * fasce, se presenti), senza esporre in pagina l'orario di apertura: il
 * vincolo resta solo nelle opzioni offerte dal campo Autocomplete, non in
 * un elenco visibile a parte (§5.7 di DEVELOPMENT.md — "orari non mostrati
 * ma presi in considerazione"). `undefined` (giorno non ancora scelto)
 * lascia il campo con tutti i 96 quarti d'ora, come prima di scegliere una
 * data; un giorno chiuso restituisce un elenco vuoto.
 */
function quarterHourOptionsForDay(day: OpeningHoursDay | undefined): string[] {
  if (!day || day.closed) return [];
  const options: string[] = [];
  const addSlot = (start: string | null, end: string | null) => {
    if (!start || !end) return;
    for (let m = toMinutes(start); m <= toMinutes(end); m += 15) options.push(minutesToLabel(m));
  };
  addSlot(day.slot1Start, day.slot1End);
  addSlot(day.slot2Start, day.slot2End);
  return options;
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
  marketingConsent: true,
  privacyPolicyConsent: true,
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
 * come per il menù pubblico. Due caselle di consenso, entrambe preattivate
 * di default: il marketing è facoltativo (disattivabile liberamente), il
 * trattamento dei dati personali è invece obbligatorio — se disattivato il
 * pulsante "Prenota" si disabilita e appare un avviso, e il backend rifiuta
 * comunque la richiesta se qualcuno la manda senza (§10 di DEVELOPMENT.md).
 * Gli orari di apertura del locale **non sono mostrati** in pagina (né
 * come elenco settimanale né come didascalia sotto la data scelta), ma
 * sono comunque presi in considerazione: il campo Orario offre solo le
 * opzioni ai 15 minuti realmente aperte per il giorno scelto
 * (`quarterHourOptionsForDay`), e se quel giorno è tutto chiuso il campo
 * resta disabilitato con un avviso generico, senza elencare gli orari.
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
            marketingConsent: form.marketingConsent,
            privacyPolicyConsent: form.privacyPolicyConsent,
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

  const {
    name,
    reservationHorizonDays,
    openingHours,
    menuAddress,
    city,
    menuPhone,
    menuInstagramUrl,
    menuFacebookUrl,
    menuWebsiteUrl,
  } = infoQuery.data;
  const hasContacts =
    menuAddress || city || menuPhone || menuInstagramUrl || menuFacebookUrl || menuWebsiteUrl;
  const today = new Date().toISOString().slice(0, 10);
  const maxDate = new Date(Date.now() + reservationHorizonDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const selectedDaySchedule = form.date
    ? openingHours.find((d) => d.dayOfWeek === new Date(`${form.date}T00:00:00`).getDay())
    : undefined;
  const dayClosed = !!form.date && !!selectedDaySchedule?.closed;
  const timeOptions = form.date ? quarterHourOptionsForDay(selectedDaySchedule) : undefined;

  const canSubmit =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.email.trim() &&
    form.phone.trim() &&
    form.date &&
    form.time &&
    Number(form.partySize) > 0 &&
    (!form.isEvent || form.eventNote.trim()) &&
    form.privacyPolicyConsent;

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
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value, time: '' }))}
            />
            <QuarterHourTimeField
              label="Orario"
              fullWidth
              value={form.time}
              onChange={(time) => setForm((f) => ({ ...f, time }))}
              options={timeOptions}
              disabled={dayClosed}
            />
          </Stack>
          {dayClosed && (
            <Alert severity="warning">Il locale è chiuso in questo giorno: scegli un'altra data.</Alert>
          )}
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

          <FormControlLabel
            control={
              <Switch
                checked={form.marketingConsent}
                onChange={(e) => setForm((f) => ({ ...f, marketingConsent: e.target.checked }))}
              />
            }
            label="Accetto di ricevere comunicazioni promozionali via email/SMS/WhatsApp (facoltativo)"
          />

          <FormControlLabel
            control={
              <Switch
                checked={form.privacyPolicyConsent}
                onChange={(e) => setForm((f) => ({ ...f, privacyPolicyConsent: e.target.checked }))}
              />
            }
            label="Autorizzo il trattamento dei dati personali secondo la normativa vigente (obbligatorio)"
          />
          {!form.privacyPolicyConsent && (
            <Alert severity="warning">
              Devi autorizzare il trattamento dei dati personali per poter prenotare.
            </Alert>
          )}

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

      {hasContacts && (
        <Box sx={{ textAlign: 'center', mt: 4, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight={700}>
            {name}
          </Typography>
          {(menuAddress || city) && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {[menuAddress, city].filter(Boolean).join(' — ')}
            </Typography>
          )}
          <Stack direction="row" spacing={1} justifyContent="center">
            {menuPhone && (
              <IconButton component="a" href={`tel:${menuPhone}`} title="Chiama">
                <PhoneIcon />
              </IconButton>
            )}
            {menuInstagramUrl && (
              <IconButton component="a" href={menuInstagramUrl} target="_blank" rel="noopener noreferrer" title="Instagram">
                <InstagramIcon />
              </IconButton>
            )}
            {menuFacebookUrl && (
              <IconButton component="a" href={menuFacebookUrl} target="_blank" rel="noopener noreferrer" title="Facebook">
                <FacebookIcon />
              </IconButton>
            )}
            {menuWebsiteUrl && (
              <IconButton component="a" href={menuWebsiteUrl} target="_blank" rel="noopener noreferrer" title="Sito web">
                <LanguageIcon />
              </IconButton>
            )}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
