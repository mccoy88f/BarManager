import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

interface ReadingRow {
  id: string;
  value: number;
  outOfRange: boolean;
  correctiveAction?: string;
  recordedAt: string;
  fridge: { label: string };
  recordedBy?: { email: string };
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Storico rilevazioni: verifica di quali anomalie ci sono state e con quale azione correttiva. */
export function ReadingsHistory() {
  const [from, setFrom] = useState(daysAgoIso(7));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const readingsQuery = useQuery({
    queryKey: ['readings-history', from, to],
    queryFn: async () =>
      (await api.get<ReadingRow[]>('/haccp/readings', { params: { from, to } })).data,
  });

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Storico rilevazioni e azioni correttive
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
          {readingsQuery.data?.map((reading) => (
            <Box
              key={reading.id}
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', sm: 'center' },
                gap: 1,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2">
                  <strong>{reading.fridge.label}</strong> — {reading.value}°C
                  {reading.correctiveAction && ` — Azione: ${reading.correctiveAction}`}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(reading.recordedAt).toLocaleString('it-IT')}
                  {reading.recordedBy?.email && ` — ${reading.recordedBy.email}`}
                </Typography>
              </Box>
              {reading.outOfRange && <Chip size="small" color="warning" label="Fuori soglia" />}
            </Box>
          ))}
          {readingsQuery.data?.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nessuna rilevazione nel periodo selezionato.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
