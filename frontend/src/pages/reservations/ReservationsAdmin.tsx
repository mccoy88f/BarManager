import { useMemo, useState } from 'react';
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
import EventSeatIcon from '@mui/icons-material/EventSeat';
import HistoryIcon from '@mui/icons-material/History';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
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
  isEvent: boolean;
  eventNote?: string | null;
  allergiesNote?: string | null;
  notes?: string | null;
  status: ReservationStatus;
  tableId?: string | null;
  table?: TableRow | null;
  rejectionReason?: string | null;
  isReturningCustomer?: boolean;
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
  tableId: '',
};

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
          tableId: manualForm.tableId || null,
        })
      ).data;
    },
    onSuccess: () => {
      invalidate();
      showToast('Prenotazione aggiunta');
      closeAddDialog();
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
            <TextField
              label="Orario"
              type="time"
              InputLabelProps={{ shrink: true }}
              fullWidth
              value={manualForm.time}
              onChange={(e) => setManualForm((f) => ({ ...f, time: e.target.value }))}
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
            select
            label="Tavolo (opzionale)"
            value={manualForm.tableId}
            helperText="Se non scelto, resta nella coda «Senza tavolo»"
            onChange={(e) => setManualForm((f) => ({ ...f, tableId: e.target.value }))}
          >
            <MenuItem value="">Nessuno</MenuItem>
            {activeTables.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.label} ({t.seats} posti)
              </MenuItem>
            ))}
          </TextField>

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
