import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  TextField,
  Typography,
  Chip,
  Stack,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/authStore';

interface LeaveRequestRow {
  id: string;
  type: 'VACATION' | 'PERMIT' | 'SICKNESS';
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  employee?: { firstName: string; lastName: string };
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

const typeLabels: Record<string, string> = {
  VACATION: 'Ferie',
  PERMIT: 'Permesso',
  SICKNESS: 'Malattia',
};

const statusColor: Record<string, 'default' | 'success' | 'error'> = {
  PENDING: 'default',
  APPROVED: 'success',
  REJECTED: 'error',
};

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/**
 * Self-service per Dipendente/Responsabile (crea per sé, vede le proprie);
 * per l'Admin (che non ha una propria scheda dipendente) diventa invece la
 * creazione di una richiesta scegliendo a quale dipendente associarla, più
 * la vista di tutte le richieste del locale con approvazione rapida.
 */
export function LeaveRequests() {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  return isAdmin ? <AdminLeaveRequests /> : <SelfServiceLeaveRequests />;
}

function SelfServiceLeaveRequests() {
  const queryClient = useQueryClient();
  const [type, setType] = useState('VACATION');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');

  const listQuery = useQuery({
    queryKey: ['leave-requests-mine'],
    queryFn: async () => (await api.get<LeaveRequestRow[]>('/leave-requests/mine')).data,
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/leave-requests', { type, startDate, endDate, note })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests-mine'] });
      setNote('');
    },
  });

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Nuova richiesta
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
            <TextField select label="Tipo" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <div />
            <TextField
              label="Dal"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <TextField
              label="Al"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <TextField
              label="Note"
              multiline
              minRows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              sx={{ gridColumn: '1 / -1' }}
            />
          </Box>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={!startDate || !endDate || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Invia richiesta
          </Button>
        </CardContent>
      </Card>

      <Typography variant="h6">Le mie richieste</Typography>
      <Stack spacing={1}>
        {listQuery.data?.map((r) => (
          <Card key={r.id} variant="outlined">
            <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Typography variant="subtitle2">{typeLabels[r.type]}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(r.startDate).toLocaleDateString('it-IT')} —{' '}
                  {new Date(r.endDate).toLocaleDateString('it-IT')}
                </Typography>
              </div>
              <Chip label={r.status} color={statusColor[r.status]} size="small" />
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}

function AdminLeaveRequests() {
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState('VACATION');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const employeesQuery = useQuery({
    queryKey: ['employees-options'],
    queryFn: async () => (await api.get<EmployeeOption[]>('/employees')).data,
  });

  const listQuery = useQuery({
    queryKey: ['leave-requests-all'],
    queryFn: async () => (await api.get<LeaveRequestRow[]>('/leave-requests')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['leave-requests-all'] });

  const createMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/leave-requests', { employeeId, type, startDate, endDate, note })).data,
    onSuccess: () => {
      invalidate();
      setEmployeeId('');
      setNote('');
      setCreateError(null);
    },
    onError: (err) => setCreateError(extractErrorMessage(err)),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      (await api.patch(`/leave-requests/${id}/review`, { status })).data,
    onSuccess: invalidate,
  });

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Nuova richiesta per un dipendente
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
            <TextField
              select
              label="Dipendente"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              {employeesQuery.data?.map((employee) => (
                <MenuItem key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label="Tipo" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Dal"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <TextField
              label="Al"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <TextField
              label="Note"
              multiline
              minRows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              sx={{ gridColumn: '1 / -1' }}
            />
          </Box>
          {createError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setCreateError(null)}>
              {createError}
            </Alert>
          )}
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={!employeeId || !startDate || !endDate || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Aggiungi richiesta
          </Button>
        </CardContent>
      </Card>

      <Typography variant="h6">Richieste del locale</Typography>
      <Stack spacing={1}>
        {listQuery.data?.map((r) => (
          <Card key={r.id} variant="outlined">
            <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Typography variant="subtitle2">
                  {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : ''} —{' '}
                  {typeLabels[r.type]}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(r.startDate).toLocaleDateString('it-IT')} —{' '}
                  {new Date(r.endDate).toLocaleDateString('it-IT')}
                </Typography>
              </div>
              {r.status === 'PENDING' ? (
                <Stack direction="row" spacing={0.5}>
                  <IconButton
                    size="small"
                    color="success"
                    title="Approva"
                    onClick={() => reviewMutation.mutate({ id: r.id, status: 'APPROVED' })}
                  >
                    <CheckIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    title="Rifiuta"
                    onClick={() => reviewMutation.mutate({ id: r.id, status: 'REJECTED' })}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ) : (
                <Chip label={r.status} color={statusColor[r.status]} size="small" />
              )}
            </CardContent>
          </Card>
        ))}
        {listQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna richiesta.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
