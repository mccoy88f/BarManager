import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

export interface Fridge {
  id: string;
  label: string;
  location?: string;
  minTemp: number;
  maxTemp: number;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Censimento frigoriferi/congelatori: etichetta, posizione e soglie di temperatura. */
export function Fridges() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ label: '', location: '', minTemp: '', maxTemp: '' });
  const [error, setError] = useState<string | null>(null);

  const fridgesQuery = useQuery({
    queryKey: ['fridges'],
    queryFn: async () => (await api.get<Fridge[]>('/haccp/fridges')).data,
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/haccp/fridges', {
          label: form.label.trim(),
          location: form.location.trim() || undefined,
          minTemp: Number(form.minTemp),
          maxTemp: Number(form.maxTemp),
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fridges'] });
      setForm({ label: '', location: '', minTemp: '', maxTemp: '' });
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const canSubmit =
    form.label.trim() !== '' &&
    form.minTemp !== '' &&
    form.maxTemp !== '' &&
    Number(form.minTemp) <= Number(form.maxTemp);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Frigoriferi e congelatori
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '2fr 2fr 1fr 1fr' } }}>
          <TextField
            label="Nome (es. Frigo bancone, Congelatore cucina)"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
          <TextField
            label="Posizione (opzionale)"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          />
          <TextField
            label="Min °C"
            type="number"
            value={form.minTemp}
            onChange={(e) => setForm((f) => ({ ...f, minTemp: e.target.value }))}
          />
          <TextField
            label="Max °C"
            type="number"
            value={form.maxTemp}
            onChange={(e) => setForm((f) => ({ ...f, maxTemp: e.target.value }))}
          />
        </Box>
        <Typography variant="caption" color="text.secondary">
          Una temperatura rilevata fuori da questo intervallo genera un avviso e richiede
          un'azione correttiva obbligatoria.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <Box>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={!canSubmit || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Aggiungi
          </Button>
        </Box>

        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 2 }}>
          {fridgesQuery.data?.map((fridge) => (
            <Chip
              key={fridge.id}
              label={`${fridge.label} (${fridge.minTemp}°C / ${fridge.maxTemp}°C)${fridge.location ? ' — ' + fridge.location : ''}`}
              variant="outlined"
            />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
