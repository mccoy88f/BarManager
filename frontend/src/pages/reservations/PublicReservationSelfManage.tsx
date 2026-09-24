import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';

type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';

interface SelfReservationDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  partySize: number;
  reservedAt: string;
  isEvent: boolean;
  eventNote?: string | null;
  allergiesNote?: string | null;
  notes?: string | null;
  status: ReservationStatus;
}

interface SelfManageResponse {
  reservation: SelfReservationDetail;
  venueName: string;
  venuePhone: string | null;
  editableUntil: string;
  canEdit: boolean;
}

const statusLabels: Record<ReservationStatus, string> = {
  PENDING: 'In attesa di conferma',
  CONFIRMED: 'Confermata',
  REJECTED: 'Rifiutata',
  CANCELLED: 'Annullata',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('it-IT')} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Operazione non riuscita. Il link potrebbe essere scaduto o già usato.';
}

/**
 * Pagina pubblica di auto-gestione del cliente (§10 di DEVELOPMENT.md),
 * senza login: raggiunta dal link nell'email di richiesta ricevuta/
 * confermata. Diversa dalla pagina di gestione dello staff
 * (`/prenota/gestisci/:id`): qui il cliente può solo modificare alcuni
 * dati o annullare la propria richiesta, entro 15 minuti dalla richiesta
 * stessa — mai Accetta/Rifiuta, che restano azioni del locale. Ogni
 * modifica riporta la prenotazione in attesa di conferma del locale.
 */
export function PublicReservationSelfManage() {
  const { id } = useParams<{ id: string }>();
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    partySize: '',
    isEvent: false,
    eventNote: '',
    allergiesNote: '',
    notes: '',
  });
  const [cancelled, setCancelled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const queryKey = ['public-reservation-self-manage', id, token];

  const manageQuery = useQuery({
    queryKey,
    queryFn: async () => (await api.get<SelfManageResponse>(`/public/reservations/${id}/self`, { params: { token } })).data,
    enabled: !!id && !!token,
  });

  useEffect(() => {
    if (!manageQuery.data) return;
    const r = manageQuery.data.reservation;
    setForm({
      firstName: r.firstName,
      lastName: r.lastName,
      phone: r.phone,
      partySize: String(r.partySize),
      isEvent: r.isEvent,
      eventNote: r.eventNote ?? '',
      allergiesNote: r.allergiesNote ?? '',
      notes: r.notes ?? '',
    });
  }, [manageQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/public/reservations/${id}/self`, {
          token,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          partySize: Number(form.partySize),
          isEvent: form.isEvent,
          eventNote: form.isEvent ? form.eventNote.trim() : '',
          allergiesNote: form.allergiesNote.trim(),
          notes: form.notes.trim(),
        })
      ).data,
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => (await api.patch(`/public/reservations/${id}/self/cancel`, { token })).data,
    onSuccess: () => {
      setConfirmCancelOpen(false);
      setCancelled(true);
    },
  });

  if (!id || !token) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 6, px: 2 }}>
        <Alert severity="error">Link non valido.</Alert>
      </Box>
    );
  }

  if (manageQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (manageQuery.isError || !manageQuery.data) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 6, px: 2 }}>
        <Alert severity="error">Link non valido o scaduto.</Alert>
      </Box>
    );
  }

  const { reservation, venueName, venuePhone, canEdit } = manageQuery.data;
  const status = cancelled ? 'CANCELLED' : reservation.status;
  const callToAction = venuePhone ? `chiamaci al ${venuePhone}` : 'contattaci direttamente';
  const canSubmit = form.firstName.trim() && form.lastName.trim() && form.phone.trim() && Number(form.partySize) > 0;

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, py: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        La tua prenotazione — {venueName}
      </Typography>

      <Card variant="outlined">
        <CardContent sx={{ display: 'grid', gap: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle1" fontWeight={600}>
              {formatWhen(reservation.reservedAt)}
            </Typography>
            <Chip
              size="small"
              color={status === 'CONFIRMED' ? 'success' : status === 'CANCELLED' || status === 'REJECTED' ? 'error' : 'warning'}
              label={statusLabels[status]}
            />
          </Stack>

          {cancelled && (
            <Alert severity="info" sx={{ mt: 1 }}>
              Prenotazione annullata. A presto!
            </Alert>
          )}

          {!cancelled && saved && (
            <Alert severity="success" sx={{ mt: 1 }}>
              Modifica inviata: la prenotazione è di nuovo in attesa di conferma da parte del locale.
            </Alert>
          )}

          {!cancelled && !canEdit && (
            <Alert severity="info" sx={{ mt: 1 }}>
              Il tempo per modificare o annullare questa prenotazione online è scaduto. Per qualsiasi modifica {callToAction}.
            </Alert>
          )}

          {!cancelled && canEdit && (
            <>
              <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
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
                label="Telefono"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
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

              <Typography variant="caption" color="text.secondary">
                Per cambiare data/ora della prenotazione, {callToAction}.
              </Typography>

              {saveMutation.isError && (
                <Alert severity="error">{extractErrorMessage(saveMutation.error)}</Alert>
              )}
              {cancelMutation.isError && (
                <Alert severity="error">{extractErrorMessage(cancelMutation.error)}</Alert>
              )}

              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  variant="contained"
                  fullWidth
                  disabled={!canSubmit || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  Salva modifiche
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  fullWidth
                  disabled={cancelMutation.isPending}
                  onClick={() => setConfirmCancelOpen(true)}
                >
                  Annulla prenotazione
                </Button>
              </Stack>
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmCancelOpen}
        title="Annullare la prenotazione?"
        message={`La prenotazione per ${form.partySize || reservation.partySize} persone del ${formatWhen(reservation.reservedAt)} verrà annullata.`}
        confirmLabel="Annulla prenotazione"
        loading={cancelMutation.isPending}
        onCancel={() => setConfirmCancelOpen(false)}
        onConfirm={() => cancelMutation.mutate()}
      />
    </Box>
  );
}
