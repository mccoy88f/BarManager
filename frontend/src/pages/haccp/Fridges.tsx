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
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

export interface Fridge {
  id: string;
  label: string;
  location?: string;
  minTemp: number;
  maxTemp: number;
}

const emptyForm = { label: '', location: '', minTemp: '', maxTemp: '' };

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
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
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
      setForm(emptyForm);
      setError(null);
      setOpen(false);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const canSubmit =
    form.label.trim() !== '' &&
    form.minTemp !== '' &&
    form.maxTemp !== '' &&
    Number(form.minTemp) <= Number(form.maxTemp);

  const openDialog = () => {
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Frigoriferi e congelatori</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openDialog}>
            Aggiungi
          </Button>
        </Box>

        <Stack direction="row" flexWrap="wrap" gap={1}>
          {fridgesQuery.data?.map((fridge) => (
            <Chip
              key={fridge.id}
              label={`${fridge.label} (${fridge.minTemp}°C / ${fridge.maxTemp}°C)${fridge.location ? ' — ' + fridge.location : ''}`}
              variant="outlined"
            />
          ))}
          {fridgesQuery.data?.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nessun frigorifero censito.
            </Typography>
          )}
        </Stack>
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nuovo frigorifero/congelatore</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 2 }}>
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
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
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
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!canSubmit || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Aggiungi
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
