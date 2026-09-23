import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  Stack,
  IconButton,
  Button,
  Divider,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from './ToastProvider';

interface AdminSummaryData {
  pendingLeaveRequests: {
    id: string;
    type: string;
    startDate: string;
    endDate: string;
    employee: { firstName: string; lastName: string };
  }[];
  notifications: { id: string; message: string; createdAt: string }[];
  ordersDueToday: { id: string; name: string }[];
  tasksDueSoon: { id: string; title: string; dueDate: string; overdue: boolean }[];
  tasksOverdueCount: number;
}

const leaveTypeLabels: Record<string, string> = {
  VACATION: 'Ferie',
  PERMIT: 'Permesso',
  SICKNESS: 'Malattia',
};

/**
 * Riepilogo mostrato in cima alla home dell'amministrazione: richieste dei
 * dipendenti in attesa, ordini da fare oggi, scadenze imminenti e notifiche.
 */
export function AdminSummary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();

  const summaryQuery = useQuery({
    queryKey: ['admin-summary'],
    queryFn: async () => (await api.get<AdminSummaryData>('/dashboard/admin-summary')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-summary'] });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      (await api.patch(`/leave-requests/${id}/review`, { status })).data,
    onSuccess: (_data, { status }) => {
      invalidate();
      showToast(status === 'APPROVED' ? 'Richiesta approvata' : 'Richiesta rifiutata');
    },
  });

  const completeTaskMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/tasks/${id}/complete`)).data,
    onSuccess: () => {
      invalidate();
      showToast('Attività completata');
    },
  });

  const dismissNotificationMutation = useMutation({
    mutationFn: async (id: string) => (await api.patch(`/notifications/${id}/read`)).data,
    onSuccess: invalidate,
  });

  const data = summaryQuery.data;
  if (!data) return null;

  const hasNothingUrgent =
    data.pendingLeaveRequests.length === 0 &&
    data.ordersDueToday.length === 0 &&
    data.tasksDueSoon.length === 0 &&
    data.notifications.length === 0;

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Oggi
      </Typography>

      {hasNothingUrgent && (
        <Typography color="text.secondary">Nessuna richiesta o scadenza urgente. 👍</Typography>
      )}

      <Grid container spacing={2}>
        {data.pendingLeaveRequests.length > 0 && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Richieste in attesa ({data.pendingLeaveRequests.length})
                </Typography>
                <Stack spacing={1} divider={<Divider />}>
                  {data.pendingLeaveRequests.map((r) => (
                    <Box key={r.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box>
                        <Typography variant="body2">
                          {r.employee.firstName} {r.employee.lastName} — {leaveTypeLabels[r.type]}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(r.startDate).toLocaleDateString('it-IT')} –{' '}
                          {new Date(r.endDate).toLocaleDateString('it-IT')}
                        </Typography>
                      </Box>
                      <Stack direction="row">
                        <IconButton
                          size="small"
                          color="success"
                          onClick={() => reviewMutation.mutate({ id: r.id, status: 'APPROVED' })}
                        >
                          <CheckIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => reviewMutation.mutate({ id: r.id, status: 'REJECTED' })}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )}

        {data.ordersDueToday.length > 0 && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Ordini da fare oggi
                </Typography>
                <Stack spacing={1} divider={<Divider />}>
                  {data.ordersDueToday.map((s) => (
                    <Box key={s.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2">{s.name}</Typography>
                      <Button size="small" onClick={() => navigate(`/inventory?supplierId=${s.id}`)}>
                        Nuovo ordine
                      </Button>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )}

        {data.tasksDueSoon.length > 0 && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Scadenze
                  {data.tasksOverdueCount > 0 && (
                    <Chip
                      size="small"
                      color="error"
                      label={`${data.tasksOverdueCount} scadute`}
                      sx={{ ml: 1 }}
                    />
                  )}
                </Typography>
                <Stack spacing={1} divider={<Divider />}>
                  {data.tasksDueSoon.map((t) => (
                    <Box key={t.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box>
                        <Typography variant="body2">{t.title}</Typography>
                        <Chip
                          size="small"
                          color={t.overdue ? 'error' : 'warning'}
                          label={new Date(t.dueDate).toLocaleDateString('it-IT')}
                        />
                      </Box>
                      <IconButton
                        size="small"
                        color="success"
                        title="Segna come completata"
                        onClick={() => completeTaskMutation.mutate(t.id)}
                      >
                        <CheckCircleIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Stack>
                <Button size="small" sx={{ mt: 1 }} onClick={() => navigate('/tasks')}>
                  Vedi tutte
                </Button>
              </CardContent>
            </Card>
          </Grid>
        )}

        {data.notifications.length > 0 && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  <NotificationsIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                  Notifiche
                </Typography>
                <Stack spacing={1} divider={<Divider />}>
                  {data.notifications.map((n) => (
                    <Box key={n.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2">{n.message}</Typography>
                      <IconButton size="small" onClick={() => dismissNotificationMutation.mutate(n.id)}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
