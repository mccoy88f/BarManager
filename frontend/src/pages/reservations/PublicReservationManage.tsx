import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CakeIcon from '@mui/icons-material/Cake';
import { api } from '../../api/client';

type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';

interface TableRow {
  id: string;
  label: string;
  seats: number;
}

interface ReservationDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  partySize: number;
  reservedAt: string;
  proposedReservedAt?: string | null;
  isEvent: boolean;
  eventNote?: string | null;
  allergiesNote?: string | null;
  notes?: string | null;
  status: ReservationStatus;
  tableId?: string | null;
  rejectionReason?: string | null;
}

const statusLabels: Record<ReservationStatus, string> = {
  PENDING: 'Da confermare',
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
 * Pagina pubblica di gestione di una prenotazione, senza login (§5.7):
 * raggiunta dal pulsante Accetta/Rifiuta nell'email inviata all'indirizzo
 * del locale. Identificata dal token della prenotazione (nella query
 * string), non richiede alcun account — pensata per essere apribile da chi
 * ha accesso a quella casella email.
 */
export function PublicReservationManage() {
  const { id } = useParams<{ id: string }>();
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  const initialAction = params.get('action');

  const [tableId, setTableId] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(initialAction === 'reject');
  const [rejectReason, setRejectReason] = useState('');
  const [resolvedStatus, setResolvedStatus] = useState<ReservationStatus | null>(null);

  const manageQuery = useQuery({
    queryKey: ['public-reservation-manage', id, token],
    queryFn: async () => {
      const { data } = await api.get<{ reservation: ReservationDetail; tables: TableRow[] }>(
        `/public/reservations/${id}/manage`,
        { params: { token } },
      );
      setTableId(data.reservation.tableId ?? '');
      return data;
    },
    enabled: !!id && !!token,
  });

  const acceptMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/public/reservations/${id}/manage/accept`, {
          token,
          tableId: tableId || null,
        })
      ).data,
    onSuccess: () => setResolvedStatus('CONFIRMED'),
  });

  const rejectMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/public/reservations/${id}/manage/reject`, {
          token,
          reason: rejectReason.trim(),
        })
      ).data,
    onSuccess: () => setResolvedStatus('REJECTED'),
  });

  const confirmTimeMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/public/reservations/${id}/manage/confirm-time`, { token })
      ).data,
    onSuccess: () => manageQuery.refetch(),
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

  const { reservation, tables } = manageQuery.data;
  const status = resolvedStatus ?? reservation.status;
  const isPending = status === 'PENDING';

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, py: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Prenotazione online
      </Typography>

      <Card variant="outlined">
        <CardContent sx={{ display: 'grid', gap: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle1" fontWeight={600}>
              {reservation.firstName} {reservation.lastName}
            </Typography>
            <Chip
              size="small"
              color={status === 'CONFIRMED' ? 'success' : status === 'REJECTED' ? 'error' : 'warning'}
              label={statusLabels[status]}
            />
            {reservation.isEvent && (
              <Chip size="small" icon={<CakeIcon fontSize="small" />} label={reservation.eventNote || 'Evento'} />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {formatWhen(reservation.reservedAt)} — {reservation.partySize} persone
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {reservation.email} — {reservation.phone}
          </Typography>
          {reservation.allergiesNote && (
            <Typography variant="body2" color="warning.main">
              Allergie/intolleranze: {reservation.allergiesNote}
            </Typography>
          )}
          {reservation.notes && (
            <Typography variant="body2" color="text.secondary">
              Note: {reservation.notes}
            </Typography>
          )}
          {status === 'REJECTED' && reservation.rejectionReason && (
            <Typography variant="body2" color="error">
              Motivo rifiuto: {reservation.rejectionReason}
            </Typography>
          )}

          {reservation.proposedReservedAt && (
            <Alert
              severity="warning"
              sx={{ mt: 1 }}
              action={
                <Button
                  size="small"
                  color="inherit"
                  disabled={confirmTimeMutation.isPending}
                  onClick={() => confirmTimeMutation.mutate()}
                >
                  Confermo il nuovo orario
                </Button>
              }
            >
              Il locale propone di spostare la prenotazione a {formatWhen(reservation.proposedReservedAt)}.
              {confirmTimeMutation.isSuccess && ' Confermato!'}
            </Alert>
          )}
          {confirmTimeMutation.isError && (
            <Alert severity="error">{extractErrorMessage(confirmTimeMutation.error)}</Alert>
          )}

          {!isPending && (
            <Alert severity="info" sx={{ mt: 1 }}>
              {resolvedStatus
                ? `Fatto: la prenotazione è stata ${resolvedStatus === 'CONFIRMED' ? 'confermata' : 'rifiutata'}.`
                : 'Questa richiesta è già stata gestita, non serve fare altro.'}
            </Alert>
          )}

          {isPending && !showRejectForm && (
            <>
              {tables.length > 0 && (
                <TextField
                  select
                  size="small"
                  label="Tavolo"
                  value={tableId}
                  sx={{ mt: 1 }}
                  onChange={(e) => setTableId(e.target.value)}
                >
                  <MenuItem value="">Nessuno</MenuItem>
                  {tables.map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.label} ({t.seats} posti)
                    </MenuItem>
                  ))}
                </TextField>
              )}

              {acceptMutation.isError && (
                <Alert severity="error">{extractErrorMessage(acceptMutation.error)}</Alert>
              )}

              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  variant="contained"
                  color="success"
                  fullWidth
                  disabled={acceptMutation.isPending}
                  onClick={() => acceptMutation.mutate()}
                >
                  Accetta
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  fullWidth
                  onClick={() => setShowRejectForm(true)}
                >
                  Rifiuta
                </Button>
              </Stack>
            </>
          )}

          {isPending && showRejectForm && (
            <>
              <TextField
                label="Motivo del rifiuto"
                multiline
                minRows={2}
                autoFocus
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                sx={{ mt: 1 }}
              />
              {rejectMutation.isError && (
                <Alert severity="error">{extractErrorMessage(rejectMutation.error)}</Alert>
              )}
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  variant="contained"
                  color="error"
                  fullWidth
                  disabled={!rejectReason.trim() || rejectMutation.isPending}
                  onClick={() => rejectMutation.mutate()}
                >
                  Confermo il rifiuto
                </Button>
                <Button fullWidth onClick={() => setShowRejectForm(false)}>
                  Annulla
                </Button>
              </Stack>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
