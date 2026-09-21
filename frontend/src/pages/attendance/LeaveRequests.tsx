import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  TextField,
  Typography,
  Chip,
  Stack,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

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

export function LeaveRequests() {
  const queryClient = useQueryClient();
  const [type, setType] = useState('VACATION');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');

  const listQuery = useQuery({
    queryKey: ['leave-requests-mine'],
    queryFn: async () => (await api.get('/leave-requests/mine')).data,
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
        {listQuery.data?.map((r: any) => (
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
