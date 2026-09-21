import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
  Typography,
  Chip,
  Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { ConfirmDialog } from '../../components/ConfirmDialog';

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
  const isManager = useAuthStore((s) => s.user?.isManager) ?? false;
  const [open, setOpen] = useState(false);
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
      setStartDate('');
      setEndDate('');
      setOpen(false);
    },
  });

  const openCreate = () => {
    setType('VACATION');
    setStartDate('');
    setEndDate('');
    setNote('');
    setOpen(true);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Le mie richieste</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Invia richiesta
        </Button>
      </Box>
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
        {listQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna richiesta.
          </Typography>
        )}
      </Stack>

      {isManager && <ApprovedRequestsManager />}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nuova richiesta</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 2 }}>
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!startDate || !endDate || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Invia richiesta
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/**
 * Sezione riservata ai dipendenti "Responsabile": elenca le richieste
 * approvate del locale, che possono sempre essere cancellate (es. per
 * correggere un errore o un cambio di programma dell'ultimo minuto).
 */
function ApprovedRequestsManager() {
  const queryClient = useQueryClient();
  const [toDelete, setToDelete] = useState<LeaveRequestRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const approvedQuery = useQuery({
    queryKey: ['leave-requests-approved'],
    queryFn: async () => (await api.get<LeaveRequestRow[]>('/leave-requests/approved')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/leave-requests/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests-approved'] });
      setToDelete(null);
      setDeleteError(null);
    },
    onError: (err) => setDeleteError(extractErrorMessage(err)),
  });

  if (approvedQuery.isError) return null;

  return (
    <>
      <Typography variant="h6">Richieste approvate del locale</Typography>
      <Stack spacing={1}>
        {approvedQuery.data?.map((r) => (
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
              <IconButton
                size="small"
                title="Elimina"
                onClick={() => {
                  setDeleteError(null);
                  setToDelete(r);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </CardContent>
          </Card>
        ))}
        {approvedQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna richiesta approvata.
          </Typography>
        )}
      </Stack>

      <ConfirmDialog
        open={!!toDelete}
        title="Eliminare la richiesta?"
        message={
          toDelete
            ? `La richiesta approvata di ${toDelete.employee?.firstName} ${toDelete.employee?.lastName} verrà eliminata definitivamente.${
                deleteError ? `\n\n${deleteError}` : ''
              }`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => {
          setToDelete(null);
          setDeleteError(null);
        }}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />
    </>
  );
}

function AdminLeaveRequests() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState('VACATION');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<LeaveRequestRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      setStartDate('');
      setEndDate('');
      setNote('');
      setCreateError(null);
      setOpen(false);
    },
    onError: (err) => setCreateError(extractErrorMessage(err)),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      (await api.patch(`/leave-requests/${id}/review`, { status })).data,
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/leave-requests/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      setDeleteError(null);
    },
    onError: (err) => setDeleteError(extractErrorMessage(err)),
  });

  const openCreate = () => {
    setEmployeeId('');
    setType('VACATION');
    setStartDate('');
    setEndDate('');
    setNote('');
    setCreateError(null);
    setOpen(true);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Richieste del locale</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Aggiungi richiesta
        </Button>
      </Box>
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
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Chip label={r.status} color={statusColor[r.status]} size="small" />
                  {r.status === 'APPROVED' && (
                    <IconButton
                      size="small"
                      title="Elimina"
                      onClick={() => {
                        setDeleteError(null);
                        setToDelete(r);
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
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

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nuova richiesta per un dipendente</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 2 }}>
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
          {createError && (
            <Alert severity="error" sx={{ gridColumn: '1 / -1' }} onClose={() => setCreateError(null)}>
              {createError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!employeeId || !startDate || !endDate || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Aggiungi richiesta
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        title="Eliminare la richiesta?"
        message={
          toDelete
            ? `La richiesta approvata di ${toDelete.employee?.firstName} ${toDelete.employee?.lastName} verrà eliminata definitivamente.${
                deleteError ? `\n\n${deleteError}` : ''
              }`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => {
          setToDelete(null);
          setDeleteError(null);
        }}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />
    </Box>
  );
}
