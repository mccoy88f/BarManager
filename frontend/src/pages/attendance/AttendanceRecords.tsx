import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
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

function firstDayOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

/** Storico timbrature con filtri ed esportazione XLS/PDF. */
export function AttendanceRecords() {
  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

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
            <CardContent sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body2">
                {record.employee.firstName} {record.employee.lastName} —{' '}
                {record.type === 'CLOCK_IN' ? 'Inizio' : 'Fine'} turno
                {record.note && ` — ${record.note}`}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {new Date(record.timestamp).toLocaleString('it-IT')}
              </Typography>
            </CardContent>
          </Card>
        ))}
        {recordsQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna timbratura nel periodo selezionato.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
