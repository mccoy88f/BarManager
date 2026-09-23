import { useMemo, useState } from 'react';
import {
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
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import CakeIcon from '@mui/icons-material/Cake';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';

interface TableRow {
  id: string;
  label: string;
  seats: number;
  active: boolean;
}

interface ReservationRow {
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
  tableId?: string | null;
  table?: TableRow | null;
  rejectionReason?: string | null;
}

const statusLabels: Record<ReservationStatus, string> = {
  PENDING: 'Da confermare',
  CONFIRMED: 'Confermata',
  REJECTED: 'Rifiutata',
  CANCELLED: 'Annullata',
};

const statusColors: Record<ReservationStatus, 'warning' | 'success' | 'error' | 'default'> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  REJECTED: 'error',
  CANCELLED: 'default',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('it-IT')} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Coda prenotazioni (§5.7): tab per stato, accetta/rifiuta con motivo,
 * riassegnazione tavolo in qualunque momento, conteggio posti disponibili
 * per l'orario della prenotazione selezionata.
 */
export function ReservationsAdmin() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [statusFilter, setStatusFilter] = useState<ReservationStatus>('PENDING');
  const [rejecting, setRejecting] = useState<ReservationRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelling, setCancelling] = useState<ReservationRow | null>(null);

  const reservationsQuery = useQuery({
    queryKey: ['reservations-admin', statusFilter],
    queryFn: async () =>
      (await api.get<ReservationRow[]>('/reservations', { params: { status: statusFilter } })).data,
  });

  const tablesQuery = useQuery({
    queryKey: ['reservations-tables'],
    queryFn: async () => (await api.get<TableRow[]>('/reservations/tables')).data,
  });
  const activeTables = useMemo(() => tablesQuery.data?.filter((t) => t.active) ?? [], [tablesQuery.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['reservations-admin'] });

  const acceptMutation = useMutation({
    mutationFn: async ({ id, tableId }: { id: string; tableId?: string | null }) =>
      (await api.patch(`/reservations/${id}/accept`, { tableId })).data,
    onSuccess: () => {
      invalidate();
      showToast('Prenotazione confermata');
    },
    onError: () => showToast('Errore durante la conferma'),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await api.patch(`/reservations/${id}/reject`, { reason })).data,
    onSuccess: () => {
      invalidate();
      setRejecting(null);
      setRejectReason('');
      showToast('Prenotazione rifiutata');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => (await api.patch(`/reservations/${id}/cancel`)).data,
    onSuccess: () => {
      invalidate();
      setCancelling(null);
      showToast('Prenotazione annullata');
    },
  });

  const reassignMutation = useMutation({
    mutationFn: async ({ id, tableId }: { id: string; tableId: string | null }) =>
      (await api.patch(`/reservations/${id}/table`, { tableId })).data,
    onSuccess: () => {
      invalidate();
      showToast('Tavolo aggiornato');
    },
  });

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Typography variant="h6">Prenotazioni</Typography>

      <Tabs value={statusFilter} onChange={(_e, v) => setStatusFilter(v)} sx={{ minHeight: 0 }}>
        {(Object.keys(statusLabels) as ReservationStatus[]).map((s) => (
          <Tab key={s} value={s} label={statusLabels[s]} sx={{ minHeight: 0 }} />
        ))}
      </Tabs>

      <Stack spacing={2}>
        {reservationsQuery.data?.map((r) => (
          <Card key={r.id} variant="outlined">
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="subtitle1" fontWeight={600}>
                      {r.firstName} {r.lastName}
                    </Typography>
                    <Chip size="small" color={statusColors[r.status]} label={statusLabels[r.status]} />
                    {r.isEvent && (
                      <Chip size="small" icon={<CakeIcon fontSize="small" />} label={r.eventNote || 'Evento'} />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {formatWhen(r.reservedAt)} — {r.partySize} persone
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {r.email} — {r.phone}
                  </Typography>
                  {r.allergiesNote && (
                    <Typography variant="body2" color="warning.main">
                      Allergie/intolleranze: {r.allergiesNote}
                    </Typography>
                  )}
                  {r.notes && (
                    <Typography variant="body2" color="text.secondary">
                      Note: {r.notes}
                    </Typography>
                  )}
                  {r.status === 'REJECTED' && r.rejectionReason && (
                    <Typography variant="body2" color="error">
                      Motivo rifiuto: {r.rejectionReason}
                    </Typography>
                  )}
                </Box>

                <Stack spacing={1} alignItems="flex-end">
                  {(r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                    <TextField
                      select
                      size="small"
                      label="Tavolo"
                      value={r.tableId ?? ''}
                      sx={{ minWidth: 160 }}
                      InputProps={{ startAdornment: <EventSeatIcon fontSize="small" sx={{ mr: 0.5 }} /> }}
                      onChange={(e) =>
                        reassignMutation.mutate({ id: r.id, tableId: e.target.value || null })
                      }
                    >
                      <MenuItem value="">Nessuno</MenuItem>
                      {activeTables.map((t) => (
                        <MenuItem key={t.id} value={t.id}>
                          {t.label} ({t.seats} posti)
                        </MenuItem>
                      ))}
                    </TextField>
                  )}

                  {r.status === 'PENDING' && (
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        onClick={() => acceptMutation.mutate({ id: r.id, tableId: r.tableId })}
                      >
                        Accetta
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={() => setRejecting(r)}
                      >
                        Rifiuta
                      </Button>
                    </Stack>
                  )}
                  {r.status === 'CONFIRMED' && (
                    <Button size="small" color="error" onClick={() => setCancelling(r)}>
                      Annulla prenotazione
                    </Button>
                  )}
                </Stack>
              </Box>
            </CardContent>
          </Card>
        ))}
        {reservationsQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna prenotazione in questo stato.
          </Typography>
        )}
      </Stack>

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Rifiuta prenotazione</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Il motivo verrà comunicato via email a {rejecting?.firstName} {rejecting?.lastName}.
          </Typography>
          <TextField
            label="Motivo del rifiuto"
            multiline
            minRows={2}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          {rejectMutation.isError && <Alert severity="error">Errore durante il rifiuto</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setRejecting(null)}>Annulla</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!rejectReason.trim() || rejectMutation.isPending}
            onClick={() => rejecting && rejectMutation.mutate({ id: rejecting.id, reason: rejectReason.trim() })}
          >
            Rifiuta
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!cancelling}
        title="Annullare la prenotazione?"
        message={
          cancelling
            ? `La prenotazione confermata di ${cancelling.firstName} ${cancelling.lastName} verrà annullata.`
            : ''
        }
        confirmLabel="Annulla prenotazione"
        loading={cancelMutation.isPending}
        onCancel={() => setCancelling(null)}
        onConfirm={() => cancelling && cancelMutation.mutate(cancelling.id)}
      />
    </Box>
  );
}
