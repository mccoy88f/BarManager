import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

interface TaskRow {
  id: string;
  title: string;
  description?: string;
  type: string;
  dueDate: string;
  recurrence: string;
  status: string;
  completedAt?: string;
  relatedEmployee?: { id: string; firstName: string; lastName: string };
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
};

/** Attività e scadenze aperte: pagamenti fornitori, visite mediche, attestati, ecc. */
export function TasksAdmin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [taskToDelete, setTaskToDelete] = useState<TaskRow | null>(null);

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'OPEN'],
    queryFn: async () => (await api.get<TaskRow[]>('/tasks', { params: { status: 'OPEN' } })).data,
  });

  const employeesQuery = useQuery({
    queryKey: ['employees-options'],
    queryFn: async () => (await api.get<EmployeeOption[]>('/employees')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tasks'] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...form, relatedEmployeeId: form.relatedEmployeeId || undefined };
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
    });
    setOpen(true);
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
                  </Stack>
                </Box>
                <Stack direction="row" spacing={0.5}>
                  <IconButton
                    color="success"
                    title="Segna come completata"
                    onClick={() => completeMutation.mutate(task.id)}
                  >
                    <CheckCircleIcon />
                  </IconButton>
                  <IconButton color="default" title="Modifica" onClick={() => openEdit(task)}>
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    color="default"
                    title="Elimina"
                    onClick={() => setTaskToDelete(task)}
                  >
                    <DeleteIcon />
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
          <div />
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
    </Box>
  );
}
