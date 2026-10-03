import { useMemo, useRef, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
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
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PrintIcon from '@mui/icons-material/Print';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';
import { printOrShare } from '../../printing/nativePrint';

import { formatCurrency, formatDate } from '../../utils/format';
interface RefOption {
  id: string;
  name: string;
}

interface ExpenseRow {
  id: string;
  description: string;
  amount: number;
  date: string;
  paymentMethod: RefOption;
  wallet: RefOption;
  task: { id: string; title: string; orderId: string | null } | null;
}

const emptyFilters = {
  dateFrom: '',
  dateTo: '',
  paymentMethodId: '',
  walletId: '',
  origin: '' as '' | 'linked' | 'standalone',
};

const emptyExpenseForm = {
  description: '',
  amount: '',
  date: new Date().toISOString().slice(0, 10),
  paymentMethodId: '',
  walletId: '',
};

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Tab "Spese": lista filtrabile/stampabile, collegata o no a una scadenza (§5.5 di DEVELOPMENT.md). */
function ExpensesTab() {
  const [tableBodyRef] = useAutoAnimate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [filters, setFilters] = useState(emptyFilters);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [form, setForm] = useState(emptyExpenseForm);
  const [toDelete, setToDelete] = useState<ExpenseRow | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const paymentMethodsQuery = useQuery({
    queryKey: ['expense-payment-methods'],
    queryFn: async () => (await api.get<RefOption[]>('/expenses/payment-methods')).data,
  });

  const walletsQuery = useQuery({
    queryKey: ['expense-wallets'],
    queryFn: async () => (await api.get<RefOption[]>('/expenses/wallets')).data,
  });

  const expensesQuery = useQuery({
    queryKey: ['expenses', filters],
    queryFn: async () =>
      (
        await api.get<ExpenseRow[]>('/expenses', {
          params: {
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
            paymentMethodId: filters.paymentMethodId || undefined,
            walletId: filters.walletId || undefined,
            origin: filters.origin || undefined,
          },
        })
      ).data,
  });

  const total = useMemo(
    () => (expensesQuery.data ?? []).reduce((sum, e) => sum + e.amount, 0),
    [expensesQuery.data],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['expenses'] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...form, amount: Number(form.amount) };
      return editing
        ? (await api.patch(`/expenses/${editing.id}`, payload)).data
        : (await api.post('/expenses', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setEditing(null);
      setForm(emptyExpenseForm);
      showToast(editing ? 'Spesa aggiornata' : 'Spesa registrata');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/expenses/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      showToast('Spesa eliminata');
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyExpenseForm);
    setOpen(true);
  };

  const openEdit = (expense: ExpenseRow) => {
    setEditing(expense);
    setForm({
      description: expense.description,
      amount: String(expense.amount),
      date: expense.date.slice(0, 10),
      paymentMethodId: expense.paymentMethod.id,
      walletId: expense.wallet.id,
    });
    setOpen(true);
  };

  const handlePrint = async () => {
    try {
      await printOrShare({
        usage: 'EXPENSES_REPORT',
        escposUrl: `/expenses/escpos?${new URLSearchParams(
          Object.entries(filters).filter(([, v]) => v) as [string, string][],
        ).toString()}`,
        printPdf: async () => {
          window.print();
        },
      });
    } catch (err) {
      showToast({
        message: `Stampa non riuscita.${err instanceof Error ? ` ${err.message}` : ''}`,
        severity: 'error',
      });
    }
  };

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">Spese</Typography>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<PrintIcon />} onClick={handlePrint}>
            Stampa
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Aggiungi spesa
          </Button>
        </Stack>
      </Box>

      <Card variant="outlined" className="no-print">
        <CardContent sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="Dal"
            type="date"
            size="small"
            InputLabelProps={{ shrink: true }}
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
          />
          <TextField
            label="Al"
            type="date"
            size="small"
            InputLabelProps={{ shrink: true }}
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
          />
          <TextField
            select
            label="Metodo di pagamento"
            size="small"
            sx={{ minWidth: 180 }}
            InputLabelProps={{ shrink: true }}
            value={filters.paymentMethodId}
            onChange={(e) => setFilters((f) => ({ ...f, paymentMethodId: e.target.value }))}
          >
            <MenuItem value="">Tutti</MenuItem>
            {paymentMethodsQuery.data?.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Portafoglio"
            size="small"
            sx={{ minWidth: 180 }}
            InputLabelProps={{ shrink: true }}
            value={filters.walletId}
            onChange={(e) => setFilters((f) => ({ ...f, walletId: e.target.value }))}
          >
            <MenuItem value="">Tutti</MenuItem>
            {walletsQuery.data?.map((w) => (
              <MenuItem key={w.id} value={w.id}>
                {w.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Origine"
            size="small"
            sx={{ minWidth: 160 }}
            InputLabelProps={{ shrink: true }}
            value={filters.origin}
            onChange={(e) => setFilters((f) => ({ ...f, origin: e.target.value as typeof filters.origin }))}
          >
            <MenuItem value="">Tutte</MenuItem>
            <MenuItem value="standalone">Solo autonome</MenuItem>
            <MenuItem value="linked">Solo da scadenza</MenuItem>
          </TextField>
          {(filters.dateFrom || filters.dateTo || filters.paymentMethodId || filters.walletId || filters.origin) && (
            <Button size="small" onClick={() => setFilters(emptyFilters)}>
              Azzera filtri
            </Button>
          )}
        </CardContent>
      </Card>

      <div ref={printRef}>
        <Box className="print-only" sx={{ display: 'none', mb: 2 }}>
          <Typography variant="h6">Report spese</Typography>
          <Typography variant="body2" color="text.secondary">
            {filters.dateFrom || filters.dateTo
              ? `Periodo: ${filters.dateFrom || '…'} — ${filters.dateTo || '…'}`
              : 'Tutte le date'}
          </Typography>
        </Box>
        <TableContainer component={Card} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Data</TableCell>
                <TableCell>Descrizione</TableCell>
                <TableCell>Metodo</TableCell>
                <TableCell>Portafoglio</TableCell>
                <TableCell>Origine</TableCell>
                <TableCell align="right">Importo</TableCell>
                <TableCell align="right" className="no-print">
                  Azioni
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody ref={tableBodyRef}>
              {expensesQuery.data?.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell>{formatDate(expense.date)}</TableCell>
                  <TableCell>{expense.description}</TableCell>
                  <TableCell>{expense.paymentMethod.name}</TableCell>
                  <TableCell>{expense.wallet.name}</TableCell>
                  <TableCell>
                    {expense.task ? (
                      <Chip size="small" variant="outlined" label={`Scadenza: ${expense.task.title}`} />
                    ) : (
                      <Chip size="small" label="Autonoma" />
                    )}
                  </TableCell>
                  <TableCell align="right">{formatCurrency(expense.amount)}</TableCell>
                  <TableCell align="right" className="no-print">
                    <IconButton size="small" title="Modifica" onClick={() => openEdit(expense)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" title="Elimina" onClick={() => setToDelete(expense)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {expensesQuery.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                      Nessuna spesa nel periodo selezionato.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Totale: {formatCurrency(total)}
          </Typography>
        </Box>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Modifica spesa' : 'Nuova spesa'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 4 }}>
          <TextField
            label="Descrizione"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            sx={{ gridColumn: '1 / -1' }}
          />
          <TextField
            label="Importo"
            type="number"
            inputProps={{ min: 0, step: 0.01 }}
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <TextField
            label="Data"
            type="date"
            InputLabelProps={{ shrink: true }}
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
          <TextField
            select
            label="Metodo di pagamento"
            InputLabelProps={{ shrink: true }}
            value={form.paymentMethodId}
            onChange={(e) => setForm((f) => ({ ...f, paymentMethodId: e.target.value }))}
          >
            {paymentMethodsQuery.data?.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Portafoglio"
            InputLabelProps={{ shrink: true }}
            value={form.walletId}
            onChange={(e) => setForm((f) => ({ ...f, walletId: e.target.value }))}
          >
            {walletsQuery.data?.map((w) => (
              <MenuItem key={w.id} value={w.id}>
                {w.name}
              </MenuItem>
            ))}
          </TextField>
          {editing?.task && (
            <Alert severity="info" sx={{ gridColumn: '1 / -1' }}>
              Collegata alla scadenza "{editing.task.title}". Modificare qui non tocca la scadenza.
            </Alert>
          )}
          {saveMutation.isError && (
            <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>
              {extractErrorMessage(saveMutation.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={
              !form.description ||
              !form.amount ||
              !form.date ||
              !form.paymentMethodId ||
              !form.walletId ||
              saveMutation.isPending
            }
            onClick={() => saveMutation.mutate()}
          >
            {editing ? 'Salva' : 'Registra'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        title="Eliminare la spesa?"
        message={
          toDelete
            ? `"${toDelete.description}" (${formatCurrency(toDelete.amount)}) verrà eliminata definitivamente.${
                toDelete.task ? ' La scadenza collegata non verrà toccata.' : ''
              }`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />
    </Box>
  );
}

/** Lista configurabile generica (Metodi di pagamento / Portafogli): stesso pattern di Fornitori/Categorie. */
function ConfigurableListCard({
  title,
  queryKey,
  path,
}: {
  title: string;
  queryKey: string;
  path: string;
}) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RefOption | null>(null);
  const [name, setName] = useState('');
  const [toDeactivate, setToDeactivate] = useState<RefOption | null>(null);

  const listQuery = useQuery({
    queryKey: [queryKey],
    queryFn: async () => (await api.get<RefOption[]>(path)).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [queryKey] });

  const saveMutation = useMutation({
    mutationFn: async () =>
      editing ? (await api.patch(`${path}/${editing.id}`, { name })).data : (await api.post(path, { name })).data,
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setEditing(null);
      setName('');
      showToast(editing ? 'Aggiornato' : 'Aggiunto');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`${path}/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDeactivate(null);
      showToast('Disattivato');
    },
  });

  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 260 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1">{title}</Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setName('');
              setOpen(true);
            }}
          >
            Aggiungi
          </Button>
        </Box>
        <Stack spacing={0.5}>
          {listQuery.data?.map((item) => (
            <Box key={item.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body2">{item.name}</Typography>
              <Stack direction="row" spacing={0.5}>
                <IconButton
                  size="small"
                  title="Modifica"
                  onClick={() => {
                    setEditing(item);
                    setName(item.name);
                    setOpen(true);
                  }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" title="Disattiva" onClick={() => setToDeactivate(item)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          ))}
          {listQuery.data?.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nessuno configurato.
            </Typography>
          )}
        </Stack>
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editing ? `Modifica ${title.toLowerCase()}` : `Nuovo ${title.toLowerCase()}`}</DialogTitle>
        <DialogContent sx={{ pt: 4 }}>
          <TextField label="Nome" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button variant="contained" disabled={!name || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {editing ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toDeactivate}
        title={`Disattivare "${toDeactivate?.name}"?`}
        message="Resta nello storico delle spese già registrate, ma non sarà più selezionabile per le nuove."
        loading={deactivateMutation.isPending}
        onCancel={() => setToDeactivate(null)}
        onConfirm={() => toDeactivate && deactivateMutation.mutate(toDeactivate.id)}
      />
    </Card>
  );
}

function SettingsTab() {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      <ConfigurableListCard title="Metodi di pagamento" queryKey="expense-payment-methods" path="/expenses/payment-methods" />
      <ConfigurableListCard title="Portafogli" queryKey="expense-wallets" path="/expenses/wallets" />
    </Box>
  );
}

/** Spese del locale (§5.5 di DEVELOPMENT.md): collegate o no a una scadenza, metodo/portafoglio configurabili, report filtrabile e stampabile. */
export function ExpensesAdmin() {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
        }
      `}</style>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} className="no-print">
        <Tab label="Spese" />
        <Tab label="Metodi e portafogli" />
      </Tabs>
      <Divider className="no-print" />
      {tab === 0 ? <ExpensesTab /> : <SettingsTab />}
    </Box>
  );
}
