import { useState } from 'react';
import { Box, Card, CardContent, Chip, IconButton, Stack, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

interface TaskRow {
  id: string;
  title: string;
  description?: string;
  type: string;
  completedAt?: string;
  relatedEmployee?: { id: string; firstName: string; lastName: string };
}

const typeLabels: Record<string, string> = {
  GENERIC: 'Generica',
  SUPPLIER_PAYMENT: 'Pagamento fornitore',
  EMPLOYEE_MEDICAL_VISIT: 'Visita medica dipendente',
  CERTIFICATE_EXPIRY: 'Scadenza attestato',
  MAINTENANCE: 'Manutenzione',
};

/** Storico delle attività già completate: sola consultazione, con possibilità di eliminarle. */
export function TasksHistory() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [taskToDelete, setTaskToDelete] = useState<TaskRow | null>(null);

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'DONE'],
    queryFn: async () => (await api.get<TaskRow[]>('/tasks', { params: { status: 'DONE' } })).data,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/tasks/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setTaskToDelete(null);
      showToast('Attività eliminata dallo storico');
    },
  });

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Typography variant="h6">Storico attività</Typography>
      <Stack spacing={1}>
        {tasksQuery.data?.map((task) => (
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
                {task.completedAt && (
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    sx={{ mt: 0.5 }}
                    label={`Completata il: ${new Date(task.completedAt).toLocaleDateString('it-IT')}`}
                  />
                )}
              </Box>
              <IconButton color="default" title="Elimina" onClick={() => setTaskToDelete(task)}>
                <DeleteIcon />
              </IconButton>
            </CardContent>
          </Card>
        ))}
        {tasksQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna attività completata finora.
          </Typography>
        )}
      </Stack>

      <ConfirmDialog
        open={!!taskToDelete}
        title="Eliminare l'attività?"
        message={taskToDelete ? `"${taskToDelete.title}" verrà eliminata definitivamente dallo storico.` : ''}
        loading={deleteMutation.isPending}
        onCancel={() => setTaskToDelete(null)}
        onConfirm={() => taskToDelete && deleteMutation.mutate(taskToDelete.id)}
      />
    </Box>
  );
}
