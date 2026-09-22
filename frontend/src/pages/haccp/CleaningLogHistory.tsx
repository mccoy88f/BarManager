import { useState } from 'react';
import { Box, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

interface CleaningLogRow {
  id: string;
  completedAt: string;
  task: { description: string; location: string };
  employee: { firstName: string; lastName: string };
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Storico pulizie: chi ha pulito cosa e quando. */
export function CleaningLogHistory() {
  const [from, setFrom] = useState(daysAgoIso(7));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const logsQuery = useQuery({
    queryKey: ['cleaning-logs', from, to],
    queryFn: async () =>
      (await api.get<CleaningLogRow[]>('/haccp/cleaning-tasks/logs', { params: { from, to } }))
        .data,
  });

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Storico pulizie
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <TextField
            label="Dal"
            type="date"
            size="small"
            InputLabelProps={{ shrink: true }}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            label="Al"
            type="date"
            size="small"
            InputLabelProps={{ shrink: true }}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Box>
        <Stack spacing={1}>
          {logsQuery.data?.map((log) => (
            <Box key={log.id}>
              <Typography variant="body2">
                <strong>{log.task.description}</strong> — {log.task.location}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {log.employee.firstName} {log.employee.lastName} —{' '}
                {new Date(log.completedAt).toLocaleString('it-IT')}
              </Typography>
            </Box>
          ))}
          {logsQuery.data?.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nessuna pulizia registrata nel periodo selezionato.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
