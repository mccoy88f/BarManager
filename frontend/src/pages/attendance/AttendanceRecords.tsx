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
import EditIcon from '@mui/icons-material/Edit';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

interface AttendanceRecordRow {
  id: string;
  type: 'CLOCK_IN' | 'CLOCK_OUT';
  timestamp: string;
  source: string;
  note?: string;
  employee: { id: string; firstName: string; lastName: string };
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

const sourceLabels: Record<string, string> = {
  QR: 'QR',
  MANUAL: 'App',
  CORRECTION: 'Corretta',
};

function firstDayOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante la correzione.';
}

/** Storico timbrature con filtri, correzione ed esportazione XLS/PDF. */
export function AttendanceRecords() {
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<AttendanceRecordRow | null>(null);
  const [newTimestamp, setNewTimestamp] = useState('');
  const [reason, setReason] = useState('');
  const [correctError, setCorrectError] = useState<string | null>(null);

  const employeesQuery = useQuery({
    queryKey: ['employees-options'],
    queryFn: async () => (await api.get<EmployeeOption[]>('/employees')).data,
  });

  const recordsQuery = useQuery({
    queryKey: ['attendance-records', employeeId, from, to],
    queryFn: async () =>
      (
        await api.get<AttendanceRecordRow[]>('/attendance', {
          params: { employeeId: employeeId || undefined, from, to },
        })
      ).data,
  });

  const correctMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/attendance/${editing!.id}/correct`, {
          timestamp: new Date(newTimestamp).toISOString(),
          reason,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-records'] });
      setEditing(null);
      setCorrectError(null);
    },
    onError: (err) => setCorrectError(extractErrorMessage(err)),
  });

  const openEdit = (record: AttendanceRecordRow) => {
    setEditing(record);
    setNewTimestamp(toDatetimeLocal(record.timestamp));
    setReason('');
    setCorrectError(null);
  };

  const download = async (format: 'xlsx' | 'pdf') => {
    const response = await api.get(`/attendance/export/${format}`, {
      params: { from, to },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `presenze.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Filtri
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr 1fr' } }}>
            <TextField
              select
              label="Dipendente"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <MenuItem value="">Tutti</MenuItem>
              {employeesQuery.data?.map((employee) => (
                <MenuItem key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Dal"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <TextField
              label="Al"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Box>
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <Button variant="outlined" onClick={() => download('xlsx')}>
              Esporta XLS
            </Button>
            <Button variant="outlined" onClick={() => download('pdf')}>
              Esporta PDF
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="h6">Timbrature</Typography>
      <Stack spacing={1}>
        {recordsQuery.data?.map((record) => (
          <Card key={record.id} variant="outlined">
            <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="body2">
                  {record.employee.firstName} {record.employee.lastName} —{' '}
                  {record.type === 'CLOCK_IN' ? 'Inizio' : 'Fine'} turno
                  {record.note && ` — ${record.note}`}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    {new Date(record.timestamp).toLocaleString('it-IT')}
                  </Typography>
                  <Chip size="small" variant="outlined" label={sourceLabels[record.source] ?? record.source} />
                </Stack>
              </Box>
              <IconButton size="small" title="Correggi" onClick={() => openEdit(record)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </CardContent>
          </Card>
        ))}
        {recordsQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna timbratura nel periodo selezionato.
          </Typography>
        )}
      </Stack>

      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Correggi timbratura</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          {editing && (
            <Typography variant="body2" color="text.secondary">
              {editing.employee.firstName} {editing.employee.lastName} —{' '}
              {editing.type === 'CLOCK_IN' ? 'Inizio' : 'Fine'} turno
            </Typography>
          )}
          <TextField
            label="Data e ora corrette"
            type="datetime-local"
            InputLabelProps={{ shrink: true }}
            value={newTimestamp}
            onChange={(e) => setNewTimestamp(e.target.value)}
          />
          <TextField
            label="Motivo della correzione"
            required
            multiline
            minRows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {correctError && <Alert severity="error">{correctError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!newTimestamp || !reason.trim() || correctMutation.isPending}
            onClick={() => correctMutation.mutate()}
          >
            Salva correzione
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
