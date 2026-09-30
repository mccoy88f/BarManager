import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  TextField,
  Typography,
  IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';
import { useAuthStore } from '../../store/authStore';
import { canAccessModule } from '../../config/modules';

interface TaskRow {
  id: string;
  title: string;
  description?: string;
  type: string;
  dueDate: string;
  recurrence: string;
  status: string;
  completedAt?: string;
  amount?: number | null;
  relatedEmployee?: { id: string; firstName: string; lastName: string };
}

interface PaymentMethodOption {
  id: string;
  name: string;
}

interface WalletOption {
  id: string;
  name: string;
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

const typeLabels: Record<string, string> = {
  GENERIC: 'Generica',
  SUPPLIER_PAYMENT: 'Pagamento fornitore',
  EMPLOYEE_MEDICAL_VISIT: 'Visita medica dipendente',
  CERTIFICATE_EXPIRY: 'Scadenza attestato',
  MAINTENANCE: 'Manutenzione',
};

const recurrenceLabels: Record<string, string> = {
  NONE: 'Non ricorrente',
  WEEKLY: 'Ogni settimana',
  MONTHLY: 'Ogni mese',
  YEARLY: 'Ogni anno',
};

const emptyForm = {
  title: '',
  description: '',
  type: 'GENERIC',
  dueDate: '',
  recurrence: 'NONE',
  relatedEmployeeId: '',
  amount: '',
};

const emptyExpenseForm = {
  description: '',
  amount: '',
  date: new Date().toISOString().slice(0, 10),
  paymentMethodId: '',
  walletId: '',
};

/** Attività e scadenze aperte: pagamenti fornitori, visite mediche, attestati, ecc. */
export function TasksAdmin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const user = useAuthStore((s) => s.user);
  const canManageExpenses = canAccessModule(user, 'expenses');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [taskToDelete, setTaskToDelete] = useState<TaskRow | null>(null);
  const [payingTask, setPayingTask] = useState<TaskRow | null>(null);
  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm);

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'OPEN'],
    queryFn: async () => (await api.get<TaskRow[]>('/tasks', { params: { status: 'OPEN' } })).data,
  });

  const employeesQuery = useQuery({
    queryKey: ['employees-options'],
    queryFn: async () => (await api.get<EmployeeOption[]>('/employees')).data,
  });

  const paymentMethodsQuery = useQuery({
    queryKey: ['expense-payment-methods'],
    queryFn: async () => (await api.get<PaymentMethodOption[]>('/expenses/payment-methods')).data,
    enabled: canManageExpenses,
  });

  const walletsQuery = useQuery({
    queryKey: ['expense-wallets'],
    queryFn: async () => (await api.get<WalletOption[]>('/expenses/wallets')).data,
    enabled: canManageExpenses,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tasks'] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        relatedEmployeeId: form.relatedEmployeeId || undefined,
        amount: form.amount === '' ? undefined : Number(form.amount),
      };
      return editing
        ? (await api.patch(`/tasks/${editing.id}`, payload)).data
        : (await api.post('/tasks', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      setForm(emptyForm);
      setOpen(false);
      setEditing(null);
      showToast(editing ? 'Attività aggiornata' : 'Attività creata');
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/tasks/${id}/complete`)).data,
    onSuccess: () => {
      invalidate();
      showToast('Attività completata');
    },
  });

  /** Registra la spesa collegata (§5.5) e poi completa la scadenza — due chiamate distinte, in sequenza. */
  const registerExpenseMutation = useMutation({
    mutationFn: async () => {
      await api.post('/expenses', {
        description: expenseForm.description,
        amount: Number(expenseForm.amount),
        date: expenseForm.date,
        paymentMethodId: expenseForm.paymentMethodId,
        walletId: expenseForm.walletId,
        taskId: payingTask!.id,
      });
      return (await api.post(`/tasks/${payingTask!.id}/complete`)).data;
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setPayingTask(null);
      showToast('Spesa registrata e attività completata');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/tasks/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setTaskToDelete(null);
      showToast('Attività eliminata');
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (task: TaskRow) => {
    setEditing(task);
    setForm({
      title: task.title,
      description: task.description ?? '',
      type: task.type,
      dueDate: task.dueDate.slice(0, 10),
      recurrence: task.recurrence,
      relatedEmployeeId: task.relatedEmployee?.id ?? '',
      amount: task.amount != null ? String(task.amount) : '',
    });
    setOpen(true);
  };

  /** Scadenze con importo atteso e permesso Spese: completare apre prima il form di registrazione pagamento (§5.5). */
  const handleComplete = (task: TaskRow) => {
    if (task.amount != null && canManageExpenses) {
      setPayingTask(task);
      setExpenseForm({
        ...emptyExpenseForm,
        description: task.title,
        amount: String(task.amount),
      });
    } else {
      completeMutation.mutate(task.id);
    }
  };

  const now = new Date();

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">Attività aperte</Typography>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<HistoryIcon />} onClick={() => navigate('/tasks/history')}>
            Storico
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Aggiungi
          </Button>
        </Stack>
      </Box>
      <Stack spacing={1}>
        {tasksQuery.data?.map((task) => {
          const overdue = new Date(task.dueDate) < now;
          return (
            <Card key={task.id} variant="outlined">
              <CardContent
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  justifyContent: 'space-between',
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  gap: 1,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2">{task.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {typeLabels[task.type]}
                    {task.relatedEmployee &&
                      ` — ${task.relatedEmployee.firstName} ${task.relatedEmployee.lastName}`}
                    {task.description && ` — ${task.description}`}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                    <Chip
                      size="small"
                      color={overdue ? 'error' : 'default'}
                      label={`Scadenza: ${new Date(task.dueDate).toLocaleDateString('it-IT')}`}
                    />
                    {task.recurrence !== 'NONE' && (
                      <Chip size="small" variant="outlined" label={recurrenceLabels[task.recurrence]} />
                    )}
                    {task.amount != null && (
                      <Chip size="small" color="primary" variant="outlined" label={`€ ${task.amount.toFixed(2)}`} />
                    )}
                  </Stack>
                </Box>
                <Stack direction="row" spacing={0.5}>
                  <IconButton
                    size="small"
                    color="success"
                    title={task.amount != null && canManageExpenses ? 'Registra pagamento e completa' : 'Segna come completata'}
                    onClick={() => handleComplete(task)}
                  >
                    <CheckCircleIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" title="Modifica" onClick={() => openEdit(task)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    title="Elimina"
                    onClick={() => setTaskToDelete(task)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </CardContent>
            </Card>
          );
        })}
        {tasksQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna attività aperta.
          </Typography>
        )}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Modifica attività/scadenza' : 'Nuova attività/scadenza'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 4 }}>
          <TextField
            label="Titolo"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <TextField
            label="Scadenza"
            type="date"
            InputLabelProps={{ shrink: true }}
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
          />
          <TextField
            select
            label="Tipo"
            InputLabelProps={{ shrink: true }}
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
          >
            {Object.entries(typeLabels).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Ricorrenza"
            InputLabelProps={{ shrink: true }}
            value={form.recurrence}
            onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value }))}
          >
            {Object.entries(recurrenceLabels).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Persona collegata (opzionale)"
            InputLabelProps={{ shrink: true }}
            value={form.relatedEmployeeId}
            onChange={(e) => setForm((f) => ({ ...f, relatedEmployeeId: e.target.value }))}
          >
            <MenuItem value="">Nessuna</MenuItem>
            {employeesQuery.data?.map((employee) => (
              <MenuItem key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Importo atteso (opzionale)"
            type="number"
            inputProps={{ min: 0, step: 0.01 }}
            helperText="Proposto per registrare la spesa al completamento (§5.5)"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <TextField
            label="Note"
            multiline
            minRows={2}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            sx={{ gridColumn: '1 / -1' }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!form.title || !form.dueDate || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {editing ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!taskToDelete}
        title="Eliminare l'attività?"
        message={
          taskToDelete
            ? `"${taskToDelete.title}" verrà eliminata definitivamente.`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => setTaskToDelete(null)}
        onConfirm={() => taskToDelete && deleteMutation.mutate(taskToDelete.id)}
      />

      <Dialog open={!!payingTask} onClose={() => setPayingTask(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Registra pagamento — {payingTask?.title}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 4 }}>
          <Alert severity="info" sx={{ gridColumn: '1 / -1' }}>
            Puoi registrare subito la spesa collegata a questa scadenza, oppure completarla senza
            registrarla (es. pagamento già tracciato altrove).
          </Alert>
          <TextField
            label="Descrizione"
            value={expenseForm.description}
            onChange={(e) => setExpenseForm((f) => ({ ...f, description: e.target.value }))}
            sx={{ gridColumn: '1 / -1' }}
          />
          <TextField
            label="Importo"
            type="number"
            inputProps={{ min: 0, step: 0.01 }}
            value={expenseForm.amount}
            onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <TextField
            label="Data"
            type="date"
            InputLabelProps={{ shrink: true }}
            value={expenseForm.date}
            onChange={(e) => setExpenseForm((f) => ({ ...f, date: e.target.value }))}
          />
          <TextField
            select
            label="Metodo di pagamento"
            InputLabelProps={{ shrink: true }}
            value={expenseForm.paymentMethodId}
            onChange={(e) => setExpenseForm((f) => ({ ...f, paymentMethodId: e.target.value }))}
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
            value={expenseForm.walletId}
            onChange={(e) => setExpenseForm((f) => ({ ...f, walletId: e.target.value }))}
          >
            {walletsQuery.data?.map((w) => (
              <MenuItem key={w.id} value={w.id}>
                {w.name}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            disabled={completeMutation.isPending}
            onClick={() => payingTask && completeMutation.mutate(payingTask.id, { onSuccess: () => setPayingTask(null) })}
          >
            Completa senza registrare spesa
          </Button>
          <Button
            variant="contained"
            startIcon={<ReceiptLongIcon />}
            disabled={
              !expenseForm.description ||
              !expenseForm.amount ||
              !expenseForm.date ||
              !expenseForm.paymentMethodId ||
              !expenseForm.walletId ||
              registerExpenseMutation.isPending
            }
            onClick={() => registerExpenseMutation.mutate()}
          >
            Registra spesa e completa
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
