import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  Stack,
  Button,
  Divider,
  Alert,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface AttendanceStatus {
  lastRecord: { type: 'CLOCK_IN' | 'CLOCK_OUT'; timestamp: string } | null;
  nextAction: 'CLOCK_IN' | 'CLOCK_OUT';
}

interface LeaveRequestRow {
  id: string;
  type: 'VACATION' | 'PERMIT' | 'SICKNESS';
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

const leaveTypeLabels: Record<string, string> = {
  VACATION: 'Ferie',
  PERMIT: 'Permesso',
  SICKNESS: 'Malattia',
};

const statusLabels: Record<string, string> = {
  PENDING: 'In attesa',
  APPROVED: 'Approvata',
  REJECTED: 'Rifiutata',
};

const statusColor: Record<string, 'default' | 'success' | 'error'> = {
  PENDING: 'default',
  APPROVED: 'success',
  REJECTED: 'error',
};

/**
 * Riepilogo mostrato in home per Dipendenti/Responsabili: stato attuale
 * della propria timbratura con pulsante diretto (senza dover scansionare un
 * QR fisico), e un recap delle proprie richieste di assenza — speculare ad
 * AdminSummary per chi gestisce il locale.
 */
export function EmployeeSummary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['attendance-status'],
    queryFn: async () => (await api.get<AttendanceStatus>('/attendance/me/status')).data,
  });

  const leaveQuery = useQuery({
    queryKey: ['leave-requests-mine'],
    queryFn: async () => (await api.get<LeaveRequestRow[]>('/leave-requests/mine')).data,
  });

  const clockMutation = useMutation({
    mutationFn: async () => (await api.post('/attendance/clock', {})).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attendance-status'] }),
  });

  if (!statusQuery.data) return null;

  const { lastRecord, nextAction } = statusQuery.data;
  const isClockedIn = nextAction === 'CLOCK_OUT';
  const recentLeaveRequests = (leaveQuery.data ?? []).slice(0, 3);

  return (
    <Box sx={{ mb: 4 }}>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                La mia timbratura
              </Typography>
              {isClockedIn && lastRecord ? (
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  In turno dalle{' '}
                  {new Date(lastRecord.timestamp).toLocaleTimeString('it-IT', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Fuori turno
                  {lastRecord &&
                    ` — ultima uscita alle ${new Date(lastRecord.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
                </Typography>
              )}

              {clockMutation.isError && (
                <Alert severity="error" sx={{ mb: 1 }}>
                  Errore nella registrazione, riprova.
                </Alert>
              )}

              <Button
                variant="contained"
                fullWidth
                size="large"
                color={isClockedIn ? 'secondary' : 'primary'}
                startIcon={isClockedIn ? <StopIcon /> : <PlayArrowIcon />}
                disabled={clockMutation.isPending}
                onClick={() => clockMutation.mutate()}
              >
                {isClockedIn ? 'Fine turno' : 'Inizio turno'}
              </Button>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Le mie richieste
              </Typography>
              {recentLeaveRequests.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nessuna richiesta recente.
                </Typography>
              ) : (
                <Stack spacing={1} divider={<Divider />}>
                  {recentLeaveRequests.map((r) => (
                    <Box
                      key={r.id}
                      sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Box>
                        <Typography variant="body2">{leaveTypeLabels[r.type]}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(r.startDate).toLocaleDateString('it-IT')} –{' '}
                          {new Date(r.endDate).toLocaleDateString('it-IT')}
                        </Typography>
                      </Box>
                      <Chip
                        size="small"
                        color={statusColor[r.status]}
                        label={statusLabels[r.status]}
                      />
                    </Box>
                  ))}
                </Stack>
              )}
              <Button
                size="small"
                sx={{ mt: 2 }}
                onClick={() => navigate('/attendance/leave-requests')}
              >
                Nuova richiesta / vedi tutte
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
