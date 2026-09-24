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
import { useToast } from '../../components/ToastProvider';
import { PENDING_CHIP_COLOR, SUCCESS_CHIP_COLOR, ERROR_CHIP_COLOR } from '../../config/statusChip';

interface LeaveRequestRow {
  id: string;
  type: 'VACATION' | 'PERMIT' | 'SICKNESS';
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  reviewedAt?: string | null;
  /** Si sovrappone (anche solo in parte) con un'altra richiesta attiva dello stesso dipendente. */
  hasOverlap?: boolean;
  employee?: { firstName: string; lastName: string };
}

interface CreateLeaveRequestResponse extends LeaveRequestRow {
  overlapWarning?: string | null;
}

function OverlapChip({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Chip
      label="Si sovrappone con un'altra richiesta"
      color="warning"
      size="small"
      variant="outlined"
      sx={{ mt: 0.5 }}
    />
  );
}

function formatRequestDates(r: LeaveRequestRow): string {
  const requested = `Richiesta il ${new Date(r.createdAt).toLocaleDateString('it-IT')}`;
  if (!r.reviewedAt) return requested;
  const reviewed = new Date(r.reviewedAt).toLocaleDateString('it-IT');
  const verb = r.status === 'APPROVED' ? 'accettata' : 'rifiutata';
  return `${requested} — ${verb} il ${reviewed}`;
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

const statusLabels: Record<string, string> = {
  PENDING: 'In attesa',
  APPROVED: 'Approvata',
  REJECTED: 'Rifiutata',
};

const statusColor: Record<string, 'warning' | 'success' | 'error'> = {
  PENDING: PENDING_CHIP_COLOR,
  APPROVED: SUCCESS_CHIP_COLOR,
  REJECTED: ERROR_CHIP_COLOR,
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
  const showToast = useToast();
  const isManager = useAuthStore((s) => s.user?.isManager) ?? false;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('VACATION');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [toCancel, setToCancel] = useState<LeaveRequestRow | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['leave-requests-mine'],
    queryFn: async () => (await api.get<LeaveRequestRow[]>('/leave-requests/mine')).data,
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      (await api.post<CreateLeaveRequestResponse>('/leave-requests', { type, startDate, endDate, note })).data,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests-mine'] });
      if (data.overlapWarning) {
        showToast({ message: data.overlapWarning, severity: 'warning' });
      } else {
        showToast('Richiesta inviata');
      }
      setNote('');
      setStartDate('');
      setEndDate('');
      setOpen(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/leave-requests/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests-mine'] });
      setToCancel(null);
      setCancelError(null);
      showToast('Richiesta annullata');
    },
    onError: (err) => setCancelError(extractErrorMessage(err)),
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">Le mie richieste</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Invia richiesta
        </Button>
      </Box>
      <Stack spacing={1}>
        {listQuery.data?.map((r) => (
          <Card key={r.id} variant="outlined">
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
                <Typography variant="subtitle2">{typeLabels[r.type]}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(r.startDate).toLocaleDateString('it-IT')} —{' '}
                  {new Date(r.endDate).toLocaleDateString('it-IT')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {formatRequestDates(r)}
                </Typography>
                <OverlapChip show={r.hasOverlap} />
              </Box>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Chip label={statusLabels[r.status]} color={statusColor[r.status]} size="small" />
                {r.status !== 'REJECTED' && (
                  <IconButton
                    size="small"
                    title="Annulla richiesta"
                    onClick={() => {
                      setCancelError(null);
                      setToCancel(r);
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            </CardContent>
          </Card>
        ))}
        {listQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna richiesta.
          </Typography>
        )}
      </Stack>

      <ConfirmDialog
        open={!!toCancel}
        title="Annullare la richiesta?"
        message={
          toCancel
            ? `La richiesta di ${typeLabels[toCancel.type].toLowerCase()} per il periodo ${new Date(toCancel.startDate).toLocaleDateString('it-IT')} — ${new Date(toCancel.endDate).toLocaleDateString('it-IT')} verrà annullata${toCancel.status === 'APPROVED' ? ' (era già approvata)' : ''}. L\'amministratore ne sarà avvisato via email.${
                cancelError ? `\n\n${cancelError}` : ''
              }`
            : ''
        }
        loading={cancelMutation.isPending}
        onCancel={() => {
          setToCancel(null);
          setCancelError(null);
        }}
        onConfirm={() => toCancel && cancelMutation.mutate(toCancel.id)}
      />

      {isManager && <ApprovedRequestsManager />}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nuova richiesta</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 4 }}>
          <TextField
            select
            label="Tipo"
            InputLabelProps={{ shrink: true }}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
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
        <DialogActions sx={{ px: 3, pb: 3 }}>
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
  const showToast = useToast();
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
      showToast('Richiesta eliminata');
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
                <Typography variant="subtitle2">
                  {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : ''} —{' '}
                  {typeLabels[r.type]}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(r.startDate).toLocaleDateString('it-IT')} —{' '}
                  {new Date(r.endDate).toLocaleDateString('it-IT')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {formatRequestDates(r)}
                </Typography>
                <OverlapChip show={r.hasOverlap} />
              </Box>
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
  const showToast = useToast();
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
      (
        await api.post<CreateLeaveRequestResponse>('/leave-requests', {
          employeeId,
          type,
          startDate,
          endDate,
          note,
        })
      ).data,
    onSuccess: (data) => {
      invalidate();
      if (data.overlapWarning) {
        showToast({ message: data.overlapWarning, severity: 'warning' });
      } else {
        showToast('Richiesta creata');
      }
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
    onSuccess: (_data, { status }) => {
      invalidate();
      showToast(status === 'APPROVED' ? 'Richiesta approvata' : 'Richiesta rifiutata');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/leave-requests/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      setDeleteError(null);
      showToast('Richiesta eliminata');
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">Richieste del locale</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Aggiungi richiesta
        </Button>
      </Box>
      <Stack spacing={1}>
        {listQuery.data?.map((r) => (
          <Card key={r.id} variant="outlined">
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
                <Typography variant="subtitle2">
                  {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : ''} —{' '}
                  {typeLabels[r.type]}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(r.startDate).toLocaleDateString('it-IT')} —{' '}
                  {new Date(r.endDate).toLocaleDateString('it-IT')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {formatRequestDates(r)}
                </Typography>
                <OverlapChip show={r.hasOverlap} />
              </Box>
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
                  <Chip label={statusLabels[r.status]} color={statusColor[r.status]} size="small" />
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
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 4 }}>
          <TextField
            select
            label="Dipendente"
            InputLabelProps={{ shrink: true }}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            {employeesQuery.data?.map((employee) => (
              <MenuItem key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Tipo"
            InputLabelProps={{ shrink: true }}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
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
        <DialogActions sx={{ px: 3, pb: 3 }}>
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
