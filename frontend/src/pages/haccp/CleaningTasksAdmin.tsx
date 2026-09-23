import { useState } from 'react';
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
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

type FrequencyUnit = 'DAY' | 'WEEK' | 'MONTH';

interface CleaningTaskRow {
  id: string;
  description: string;
  location: string;
  frequencyUnit: FrequencyUnit;
  timesPerUnit: number;
}

const unitLabels: Record<FrequencyUnit, string> = {
  DAY: 'giorno',
  WEEK: 'settimana',
  MONTH: 'mese',
};

function frequencyLabel(unit: FrequencyUnit, times: number): string {
  if (times <= 1) {
    return unit === 'DAY' ? 'Giornaliera' : unit === 'WEEK' ? 'Settimanale' : 'Mensile';
  }
  return `${times} volte al ${unitLabels[unit]}`;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

const emptyForm = {
  description: '',
  location: '',
  frequencyUnit: 'DAY' as FrequencyUnit,
  timesPerUnit: '1',
};

/** Anagrafica voci di pulizia ricorrenti (admin): descrizione, luogo e frequenza. */
export function CleaningTasksAdmin() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CleaningTaskRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<CleaningTaskRow | null>(null);

  const tasksQuery = useQuery({
    queryKey: ['cleaning-tasks'],
    queryFn: async () => (await api.get<CleaningTaskRow[]>('/haccp/cleaning-tasks')).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cleaning-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['cleaning-due'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        description: form.description.trim(),
        location: form.location.trim(),
        frequencyUnit: form.frequencyUnit,
        timesPerUnit: Number(form.timesPerUnit),
      };
      return editing
        ? (await api.patch(`/haccp/cleaning-tasks/${editing.id}`, payload)).data
        : (await api.post('/haccp/cleaning-tasks', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      showToast(editing ? 'Attività di pulizia aggiornata' : 'Attività di pulizia creata');
      setForm(emptyForm);
      setError(null);
      setOpen(false);
      setEditing(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/haccp/cleaning-tasks/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setTaskToDelete(null);
      showToast('Attività di pulizia eliminata');
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  };

  const openEdit = (task: CleaningTaskRow) => {
    setEditing(task);
    setForm({
      description: task.description,
      location: task.location,
      frequencyUnit: task.frequencyUnit,
      timesPerUnit: String(task.timesPerUnit),
    });
    setError(null);
    setOpen(true);
  };

  const canSubmit =
    form.description.trim() !== '' && form.location.trim() !== '' && Number(form.timesPerUnit) >= 1;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Voci di pulizia</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Aggiungi
          </Button>
        </Box>

        <Stack spacing={1}>
          {tasksQuery.data?.map((task) => (
            <Box
              key={task.id}
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {task.description}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {task.location}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Chip
                  size="small"
                  label={frequencyLabel(task.frequencyUnit, task.timesPerUnit)}
                />
                <IconButton size="small" title="Modifica" onClick={() => openEdit(task)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" title="Elimina" onClick={() => setTaskToDelete(task)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          ))}
          {tasksQuery.data?.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nessuna voce di pulizia censita.
            </Typography>
          )}
        </Stack>
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Modifica voce di pulizia' : 'Nuova voce di pulizia'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 3 }}>
          <TextField
            label="Descrizione (es. Sgrassare friggitrice)"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            sx={{ gridColumn: '1 / -1' }}
          />
          <TextField
            label="Luogo (es. Cucina)"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            sx={{ gridColumn: '1 / -1' }}
          />
          <TextField
            select
            label="Ogni"
            InputLabelProps={{ shrink: true }}
            value={form.frequencyUnit}
            onChange={(e) =>
              setForm((f) => ({ ...f, frequencyUnit: e.target.value as FrequencyUnit }))
            }
          >
            <MenuItem value="DAY">Giorno</MenuItem>
            <MenuItem value="WEEK">Settimana</MenuItem>
            <MenuItem value="MONTH">Mese</MenuItem>
          </TextField>
          <TextField
            label="Quante volte"
            type="number"
            value={form.timesPerUnit}
            onChange={(e) => setForm((f) => ({ ...f, timesPerUnit: e.target.value }))}
            helperText="1 = una volta sola nel periodo"
          />
          {error && (
            <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!canSubmit || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {editing ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!taskToDelete}
        title="Eliminare la voce di pulizia?"
        message={
          taskToDelete
            ? `"${taskToDelete.description}" (${taskToDelete.location}) non sarà più richiesta ai dipendenti. Lo storico di chi l'ha già pulita resta consultabile.`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => setTaskToDelete(null)}
        onConfirm={() => taskToDelete && deleteMutation.mutate(taskToDelete.id)}
      />
    </Card>
  );
}
