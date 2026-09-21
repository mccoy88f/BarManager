import { useState } from 'react';
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
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface TaskRow {
  id: string;
  title: string;
  description?: string;
  type: string;
  dueDate: string;
  recurrence: string;
  status: string;
  relatedEmployee?: { firstName: string; lastName: string };
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

/** Attività e scadenze: pagamenti fornitori, visite mediche, attestati, ecc. */
export function TasksAdmin() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
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

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/tasks', {
          ...form,
          relatedEmployeeId: form.relatedEmployeeId || undefined,
        })
      ).data,
    onSuccess: () => {
      invalidate();
      setForm(emptyForm);
      setOpen(false);
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/tasks/${id}/complete`)).data,
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/tasks/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setTaskToDelete(null);
    },
  });

  const openCreate = () => {
    setForm(emptyForm);
    setOpen(true);
  };

  const now = new Date();

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Attività aperte</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Aggiungi
        </Button>
      </Box>
      <Stack spacing={1}>
        {tasksQuery.data?.map((task) => {
          const overdue = new Date(task.dueDate) < now;
          return (
            <Card key={task.id} variant="outlined">
              <CardContent
                sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Box>
                  <Typography variant="subtitle2">{task.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {typeLabels[task.type]}
                    {task.relatedEmployee &&
                      ` — ${task.relatedEmployee.firstName} ${task.relatedEmployee.lastName}`}
                    {task.description && ` — ${task.description}`}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
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
        <DialogTitle>Nuova attività/scadenza</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 1 }}>
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
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!form.title || !form.dueDate || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Aggiungi
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
