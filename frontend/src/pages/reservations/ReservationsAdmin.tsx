import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CakeIcon from '@mui/icons-material/Cake';
import HistoryIcon from '@mui/icons-material/History';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { QuarterHourTimeField } from '../../components/QuarterHourTimeField';
import { useToast } from '../../components/ToastProvider';

type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
/** "Senza tavolo" non è uno stato reale: è un filtro lato server che ignora lo stato (§10). */
type QueueFilter = ReservationStatus | 'WITHOUT_TABLE';

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
  proposedReservedAt?: string | null;
  slotDurationMinutes?: number | null;
  isEvent: boolean;
  eventNote?: string | null;
  allergiesNote?: string | null;
  notes?: string | null;
  status: ReservationStatus;
  tableIds: string[];
  tables: TableRow[];
  rejectionReason?: string | null;
  isReturningCustomer?: boolean;
  busyTableIds?: string[];
}

/** Etichetta comune per un tavolo nei campi di scelta (select/Autocomplete). */
function tableLabel(t: TableRow): string {
  return `${t.label} (${t.seats} posti)`;
}

interface CustomerSuggestion {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  count: number;
  lastReservedAt: string;
}

const statusLabels: Record<ReservationStatus, string> = {
  PENDING: 'Da confermare',
  CONFIRMED: 'Confermata',
  REJECTED: 'Rifiutata',
  CANCELLED: 'Annullata',
};

const tabLabels: Record<QueueFilter, string> = {
  ...statusLabels,
  WITHOUT_TABLE: 'Senza tavolo',
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

function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio della prenotazione.';
}

const emptyManualForm = {
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
  tableIds: [] as string[],
  slotDurationMinutes: '',
};

interface EditForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  partySize: string;
  isEvent: boolean;
  eventNote: string;
  allergiesNote: string;
  notes: string;
  slotDurationMinutes: string;
}

function toEditForm(r: ReservationRow): EditForm {
  return {
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    partySize: String(r.partySize),
    isEvent: r.isEvent,
    eventNote: r.eventNote ?? '',
    allergiesNote: r.allergiesNote ?? '',
    notes: r.notes ?? '',
    slotDurationMinutes: r.slotDurationMinutes != null ? String(r.slotDurationMinutes) : '',
  };
}

/**
 * Coda prenotazioni (§5.7): tab per stato (più "Senza tavolo", che
 * raggruppa le richieste ancora senza un tavolo assegnato qualunque sia il
 * loro stato), accetta/rifiuta con motivo, riassegnazione tavolo in
 * qualunque momento, aggiunta manuale in backoffice (telefono/di persona,
 * §10) con ricerca di clienti già prenotati e storico cliente.
 */
export function ReservationsAdmin() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [statusFilter, setStatusFilter] = useState<QueueFilter>('PENDING');
  const [rejecting, setRejecting] = useState<ReservationRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelling, setCancelling] = useState<ReservationRow | null>(null);
  const [historyEmail, setHistoryEmail] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [manualCustomerCount, setManualCustomerCount] = useState<number | null>(null);

  const [changingTime, setChangingTime] = useState<ReservationRow | null>(null);
  const [timeForm, setTimeForm] = useState({ date: '', time: '' });

  const [editing, setEditing] = useState<ReservationRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  const reservationsQuery = useQuery({
    queryKey: ['reservations-admin', statusFilter],
    queryFn: async () =>
      (
        await api.get<ReservationRow[]>('/reservations', {
          params:
            statusFilter === 'WITHOUT_TABLE'
              ? { withoutTable: 'true' }
              : { status: statusFilter },
        })
      ).data,
  });

  const tablesQuery = useQuery({
    queryKey: ['reservations-tables'],
    queryFn: async () => (await api.get<TableRow[]>('/reservations/tables')).data,
  });
  const activeTables = useMemo(() => tablesQuery.data?.filter((t) => t.active) ?? [], [tablesQuery.data]);

  const manualReservedAtIso =
    manualForm.date && manualForm.time
      ? new Date(`${manualForm.date}T${manualForm.time}:00`).toISOString()
      : null;
  const manualAvailabilityQuery = useQuery({
    queryKey: ['reservations-table-availability', manualReservedAtIso, manualForm.slotDurationMinutes],
    queryFn: async () =>
      (
        await api.get<TableRow[]>('/reservations/table-availability', {
          params: {
            reservedAt: manualReservedAtIso,
            durationMinutes: manualForm.slotDurationMinutes || undefined,
          },
        })
      ).data,
    enabled: addOpen && !!manualReservedAtIso,
  });
  /** Senza data/ora scelte non c'è ancora nulla da escludere: si parte dall'elenco completo dei tavoli attivi. */
  const manualTableOptions: TableRow[] = manualAvailabilityQuery.data ?? activeTables;
  // Se un tavolo scelto risulta diventato occupato (cambio data/ora/durata), lo si deseleziona:
  // non deve restare un tavolo scelto che non è più nell'elenco disponibile.
  useEffect(() => {
    setManualForm((f) => {
      const stillAvailable = f.tableIds.filter((id) => manualTableOptions.some((t) => t.id === id));
      return stillAvailable.length === f.tableIds.length ? f : { ...f, tableIds: stillAvailable };
    });
  }, [manualTableOptions]);

  const customerSearchQuery = useQuery({
    queryKey: ['reservations-customers-search', customerQuery],
    queryFn: async () =>
      (
        await api.get<CustomerSuggestion[]>('/reservations/customers/search', {
          params: { query: customerQuery },
        })
      ).data,
    enabled: addOpen && customerQuery.trim().length >= 2,
  });

  const historyQuery = useQuery({
    queryKey: ['reservations-customer-history', historyEmail],
    queryFn: async () =>
      (
        await api.get<ReservationRow[]>('/reservations/customers/history', {
          params: { email: historyEmail },
        })
      ).data,
    enabled: !!historyEmail,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['reservations-admin'] });

  const acceptMutation = useMutation({
    mutationFn: async ({ id, tableIds }: { id: string; tableIds?: string[] }) =>
      (await api.patch(`/reservations/${id}/accept`, { tableIds })).data,
    onSuccess: () => {
      invalidate();
      showToast('Prenotazione confermata');
    },
    onError: (error) => {
      invalidate();
      showToast(extractErrorMessage(error));
    },
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
    mutationFn: async ({ id, tableIds }: { id: string; tableIds: string[] }) =>
      (await api.patch(`/reservations/${id}/table`, { tableIds })).data,
    onSuccess: () => {
      invalidate();
      showToast('Tavolo aggiornato');
    },
    onError: (error) => {
      invalidate();
      showToast(extractErrorMessage(error));
    },
  });

  const createManualMutation = useMutation({
    mutationFn: async () => {
      const reservedAt = new Date(`${manualForm.date}T${manualForm.time}:00`).toISOString();
      return (
        await api.post('/reservations/manual', {
          firstName: manualForm.firstName.trim(),
          lastName: manualForm.lastName.trim(),
          email: manualForm.email.trim(),
          phone: manualForm.phone.trim(),
          partySize: Number(manualForm.partySize),
          reservedAt,
          isEvent: manualForm.isEvent,
          eventNote: manualForm.isEvent ? manualForm.eventNote.trim() : undefined,
          allergiesNote: manualForm.allergiesNote.trim() || undefined,
          notes: manualForm.notes.trim() || undefined,
          tableIds: manualForm.tableIds,
          slotDurationMinutes: manualForm.slotDurationMinutes ? Number(manualForm.slotDurationMinutes) : undefined,
        })
      ).data;
    },
    onSuccess: () => {
      invalidate();
      showToast('Prenotazione aggiunta');
      closeAddDialog();
    },
  });

  const proposeTimeMutation = useMutation({
    mutationFn: async ({ id, reservedAt }: { id: string; reservedAt: string }) =>
      (await api.patch(`/reservations/${id}/time`, { reservedAt })).data,
    onSuccess: () => {
      invalidate();
      setChangingTime(null);
      showToast('Nuovo orario proposto: in attesa di conferma del cliente');
    },
  });

  const updateReservationMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      (await api.patch(`/reservations/${id}`, data)).data,
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setEditForm(null);
      showToast('Prenotazione aggiornata');
    },
  });

  const closeAddDialog = () => {
    setAddOpen(false);
    setManualForm(emptyManualForm);
    setManualCustomerCount(null);
    setCustomerQuery('');
  };

  const applyCustomerSuggestion = (customer: CustomerSuggestion) => {
    setManualForm((f) => ({
      ...f,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
    }));
    setManualCustomerCount(customer.count);
  };

  const canCreateManual =
    manualForm.firstName.trim() &&
    manualForm.lastName.trim() &&
    manualForm.email.trim() &&
    manualForm.phone.trim() &&
    manualForm.date &&
    manualForm.time &&
    Number(manualForm.partySize) > 0;

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">Prenotazioni</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
          Aggiungi prenotazione
        </Button>
      </Box>

      <Tabs
        value={statusFilter}
        onChange={(_e, v) => setStatusFilter(v)}
        sx={{ minHeight: 0 }}
        variant="scrollable"
        scrollButtons="auto"
      >
        {(Object.keys(tabLabels) as QueueFilter[]).map((s) => (
          <Tab key={s} value={s} label={tabLabels[s]} sx={{ minHeight: 0 }} />
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
                    {r.isReturningCustomer && (
                      <IconButton
                        size="small"
                        title="Cliente già prenotato: vedi storico"
                        onClick={() => setHistoryEmail(r.email)}
                      >
                        <HistoryIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {formatWhen(r.reservedAt)} — {r.partySize} persone
                    {r.slotDurationMinutes != null && ` — durata ${r.slotDurationMinutes} min`}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {r.email} — {r.phone}
                  </Typography>
                  {r.proposedReservedAt && (
                    <Chip
                      size="small"
                      color="warning"
                      sx={{ mt: 0.5 }}
                      label={`In attesa di conferma nuovo orario: ${formatWhen(r.proposedReservedAt)}`}
                    />
                  )}
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
                    <Autocomplete
                      multiple
                      size="small"
                      disableCloseOnSelect
                      sx={{ minWidth: 220 }}
                      options={activeTables.filter((t) => r.tableIds.includes(t.id) || !r.busyTableIds?.includes(t.id))}
                      value={activeTables.filter((t) => r.tableIds.includes(t.id))}
                      getOptionLabel={tableLabel}
                      isOptionEqualToValue={(a, b) => a.id === b.id}
                      onChange={(_e, value) =>
                        reassignMutation.mutate({ id: r.id, tableIds: value.map((t) => t.id) })
                      }
                      renderInput={(params) => (
                        <TextField {...params} label="Tavoli" placeholder="Cerca un tavolo..." />
                      )}
                    />
                  )}

                  {(r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        onClick={() => {
                          setChangingTime(r);
                          setTimeForm(splitDateTime(r.proposedReservedAt ?? r.reservedAt));
                        }}
                      >
                        Cambia orario
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setEditing(r);
                          setEditForm(toEditForm(r));
                        }}
                      >
                        Modifica
                      </Button>
                    </Stack>
                  )}

                  {r.status === 'PENDING' && (
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        onClick={() => acceptMutation.mutate({ id: r.id, tableIds: r.tableIds })}
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
            {statusFilter === 'WITHOUT_TABLE'
              ? 'Nessuna prenotazione senza tavolo.'
              : 'Nessuna prenotazione in questo stato.'}
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

      {/* Cambio orario (§10): non applica subito la modifica, propone il
          nuovo orario al cliente e attende la sua conferma via email. */}
      <Dialog open={!!changingTime} onClose={() => setChangingTime(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Cambia orario</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Il nuovo orario verrà proposto a {changingTime?.firstName} {changingTime?.lastName}, che dovrà
            confermarlo via email prima che diventi effettivo.
          </Typography>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Data"
              type="date"
              InputLabelProps={{ shrink: true }}
              fullWidth
              value={timeForm.date}
              onChange={(e) => setTimeForm((f) => ({ ...f, date: e.target.value }))}
            />
            <QuarterHourTimeField
              label="Orario"
              fullWidth
              value={timeForm.time}
              onChange={(time) => setTimeForm((f) => ({ ...f, time }))}
            />
          </Stack>
          {proposeTimeMutation.isError && (
            <Alert severity="error">{extractErrorMessage(proposeTimeMutation.error)}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setChangingTime(null)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!timeForm.date || !timeForm.time || proposeTimeMutation.isPending}
            onClick={() =>
              changingTime &&
              proposeTimeMutation.mutate({
                id: changingTime.id,
                reservedAt: new Date(`${timeForm.date}T${timeForm.time}:00`).toISOString(),
              })
            }
          >
            Proponi nuovo orario
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modifica generale (§10): dati cliente, note e durata di occupazione
          — non richiede conferma del cliente (a differenza del cambio orario). */}
      <Dialog
        open={!!editing}
        onClose={() => {
          setEditing(null);
          setEditForm(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Modifica prenotazione</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 3 }}>
          {editForm && (
            <>
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Nome"
                  fullWidth
                  value={editForm.firstName}
                  onChange={(e) => setEditForm((f) => f && { ...f, firstName: e.target.value })}
                />
                <TextField
                  label="Cognome"
                  fullWidth
                  value={editForm.lastName}
                  onChange={(e) => setEditForm((f) => f && { ...f, lastName: e.target.value })}
                />
              </Stack>
              <TextField
                label="Email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => f && { ...f, email: e.target.value })}
              />
              <TextField
                label="Telefono"
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => f && { ...f, phone: e.target.value })}
              />
              <TextField
                label="Numero di persone"
                type="number"
                inputProps={{ min: 1 }}
                value={editForm.partySize}
                onChange={(e) => setEditForm((f) => f && { ...f, partySize: e.target.value })}
              />
              <TextField
                label="Durata occupazione tavolo (minuti, opzionale)"
                type="number"
                inputProps={{ min: 15, step: 15 }}
                helperText="Vuoto = usa il default del locale"
                value={editForm.slotDurationMinutes}
                onChange={(e) => setEditForm((f) => f && { ...f, slotDurationMinutes: e.target.value })}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={editForm.isEvent}
                    onChange={(e) => setEditForm((f) => f && { ...f, isEvent: e.target.checked })}
                  />
                }
                label="È per un'occasione speciale (es. compleanno)"
              />
              {editForm.isEvent && (
                <TextField
                  label="Descrivi l'occasione"
                  value={editForm.eventNote}
                  onChange={(e) => setEditForm((f) => f && { ...f, eventNote: e.target.value })}
                />
              )}
              <TextField
                label="Intolleranze o allergie (opzionale)"
                value={editForm.allergiesNote}
                onChange={(e) => setEditForm((f) => f && { ...f, allergiesNote: e.target.value })}
              />
              <TextField
                label="Altre note (opzionale)"
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => f && { ...f, notes: e.target.value })}
              />
            </>
          )}
          {updateReservationMutation.isError && (
            <Alert severity="error">{extractErrorMessage(updateReservationMutation.error)}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => {
              setEditing(null);
              setEditForm(null);
            }}
          >
            Annulla
          </Button>
          <Button
            variant="contained"
            disabled={
              !editForm ||
              !editForm.firstName.trim() ||
              !editForm.lastName.trim() ||
              !editForm.email.trim() ||
              !editForm.phone.trim() ||
              Number(editForm.partySize) <= 0 ||
              updateReservationMutation.isPending
            }
            onClick={() => {
              if (!editing || !editForm) return;
              updateReservationMutation.mutate({
                id: editing.id,
                data: {
                  firstName: editForm.firstName.trim(),
                  lastName: editForm.lastName.trim(),
                  email: editForm.email.trim(),
                  phone: editForm.phone.trim(),
                  partySize: Number(editForm.partySize),
                  isEvent: editForm.isEvent,
                  eventNote: editForm.isEvent ? editForm.eventNote.trim() : '',
                  allergiesNote: editForm.allergiesNote.trim(),
                  notes: editForm.notes.trim(),
                  slotDurationMinutes: editForm.slotDurationMinutes ? Number(editForm.slotDurationMinutes) : null,
                },
              });
            }}
          >
            Salva
          </Button>
        </DialogActions>
      </Dialog>

      {/* Aggiunta manuale in backoffice (telefono/di persona, §10): nessun
          vincolo di disponibilità/overbooking, tavolo opzionale — se non
          scelto, la prenotazione finisce nella coda "Senza tavolo". */}
      <Dialog open={addOpen} onClose={closeAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Aggiungi prenotazione</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 3 }}>
          <Autocomplete
            freeSolo
            options={customerSearchQuery.data ?? []}
            filterOptions={(x) => x}
            getOptionLabel={(o) => (typeof o === 'string' ? o : `${o.firstName} ${o.lastName} — ${o.email}`)}
            inputValue={customerQuery}
            onInputChange={(_e, value) => setCustomerQuery(value)}
            onChange={(_e, value) => {
              if (value && typeof value !== 'string') applyCustomerSuggestion(value);
            }}
            renderOption={(props, option) => (
              <li {...props} key={option.email}>
                {option.firstName} {option.lastName} — {option.email} ({option.count}{' '}
                {option.count === 1 ? 'prenotazione' : 'prenotazioni'})
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Cerca un cliente già prenotato (nome, email o telefono)"
                helperText="Oppure inserisci i dati di un nuovo cliente qui sotto"
              />
            )}
          />

          {manualCustomerCount != null && manualCustomerCount > 1 && (
            <Alert
              severity="info"
              action={
                <Button size="small" onClick={() => setHistoryEmail(manualForm.email)}>
                  Vedi storico
                </Button>
              }
            >
              Cliente già prenotato {manualCustomerCount} volte.
            </Alert>
          )}

          <Stack direction="row" spacing={2}>
            <TextField
              label="Nome"
              fullWidth
              value={manualForm.firstName}
              onChange={(e) => setManualForm((f) => ({ ...f, firstName: e.target.value }))}
            />
            <TextField
              label="Cognome"
              fullWidth
              value={manualForm.lastName}
              onChange={(e) => setManualForm((f) => ({ ...f, lastName: e.target.value }))}
            />
          </Stack>
          <TextField
            label="Email"
            type="email"
            value={manualForm.email}
            onChange={(e) => setManualForm((f) => ({ ...f, email: e.target.value }))}
          />
          <TextField
            label="Telefono"
            value={manualForm.phone}
            onChange={(e) => setManualForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Data"
              type="date"
              InputLabelProps={{ shrink: true }}
              fullWidth
              value={manualForm.date}
              onChange={(e) => setManualForm((f) => ({ ...f, date: e.target.value }))}
            />
            <QuarterHourTimeField
              label="Orario"
              fullWidth
              value={manualForm.time}
              onChange={(time) => setManualForm((f) => ({ ...f, time }))}
            />
          </Stack>
          <TextField
            label="Numero di persone"
            type="number"
            inputProps={{ min: 1 }}
            value={manualForm.partySize}
            onChange={(e) => setManualForm((f) => ({ ...f, partySize: e.target.value }))}
          />
          <TextField
            label="Durata occupazione tavolo (minuti, opzionale)"
            type="number"
            inputProps={{ min: 15, step: 15 }}
            helperText="Vuoto = usa il default del locale"
            value={manualForm.slotDurationMinutes}
            onChange={(e) => setManualForm((f) => ({ ...f, slotDurationMinutes: e.target.value }))}
          />
          <Autocomplete
            multiple
            disableCloseOnSelect
            options={manualTableOptions}
            value={manualTableOptions.filter((t) => manualForm.tableIds.includes(t.id))}
            getOptionLabel={tableLabel}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_e, value) => setManualForm((f) => ({ ...f, tableIds: value.map((t) => t.id) }))}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Tavoli (opzionale)"
                placeholder="Cerca un tavolo..."
                helperText="Se non scelto, resta nella coda «Senza tavolo»; più tavoli insieme per un gruppo grande"
              />
            )}
          />

          <FormControlLabel
            control={
              <Switch
                checked={manualForm.isEvent}
                onChange={(e) => setManualForm((f) => ({ ...f, isEvent: e.target.checked }))}
              />
            }
            label="È per un'occasione speciale (es. compleanno)"
          />
          {manualForm.isEvent && (
            <TextField
              label="Descrivi l'occasione"
              value={manualForm.eventNote}
              onChange={(e) => setManualForm((f) => ({ ...f, eventNote: e.target.value }))}
            />
          )}
          <TextField
            label="Intolleranze o allergie (opzionale)"
            value={manualForm.allergiesNote}
            onChange={(e) => setManualForm((f) => ({ ...f, allergiesNote: e.target.value }))}
          />
          <TextField
            label="Altre note (opzionale)"
            value={manualForm.notes}
            onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))}
          />

          {createManualMutation.isError && (
            <Alert severity="error">{extractErrorMessage(createManualMutation.error)}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={closeAddDialog}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!canCreateManual || createManualMutation.isPending}
            onClick={() => createManualMutation.mutate()}
          >
            Aggiungi
          </Button>
        </DialogActions>
      </Dialog>

      {/* Storico cliente: riusata sia dalla coda (icona sulla card) sia dal dialog di aggiunta manuale. */}
      <Dialog open={!!historyEmail} onClose={() => setHistoryEmail(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Storico prenotazioni — {historyEmail}</DialogTitle>
        <DialogContent>
          <List dense>
            {historyQuery.data?.map((r) => (
              <ListItem key={r.id} disableGutters>
                <ListItemText
                  primary={`${formatWhen(r.reservedAt)} — ${r.partySize} persone`}
                  secondary={
                    <Chip size="small" sx={{ mt: 0.5 }} color={statusColors[r.status]} label={statusLabels[r.status]} />
                  }
                />
              </ListItem>
            ))}
            {historyQuery.data?.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Nessuna prenotazione precedente.
              </Typography>
            )}
          </List>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setHistoryEmail(null)}>Chiudi</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
