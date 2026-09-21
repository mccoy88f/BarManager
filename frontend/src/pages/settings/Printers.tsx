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
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface PrinterRow {
  id: string;
  name: string;
  host: string;
  port: number;
  usage: 'HACCP' | 'ORDERS' | 'GENERIC';
  active: boolean;
}

const usageLabels: Record<string, string> = {
  HACCP: 'Report HACCP',
  ORDERS: 'Checklist ordini',
  GENERIC: 'Generico',
};

const emptyForm = { name: '', host: '', port: '9100', usage: 'GENERIC' };

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Stampanti di rete (POS Epson ESC/POS) usate per report HACCP e checklist ordini. */
export function Printers() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<PrinterRow | null>(null);

  const printersQuery = useQuery({
    queryKey: ['printers'],
    queryFn: async () => (await api.get<PrinterRow[]>('/printers')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['printers'] });

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/printers', {
          name: form.name.trim(),
          host: form.host.trim(),
          port: Number(form.port),
          usage: form.usage,
        })
      ).data,
    onSuccess: () => {
      invalidate();
      setForm(emptyForm);
      setError(null);
      setOpen(false);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch(`/printers/${id}`, { active })).data,
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/printers/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDelete(null);
    },
  });

  const openCreate = () => {
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">Stampanti di rete</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Aggiungi
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Stampanti POS Epson (ESC/POS) raggiungibili in rete sulla porta indicata, usate per il
          report HACCP giornaliero e la checklist degli ordini fornitori.
        </Typography>

        <Stack spacing={1} sx={{ mt: 2 }}>
          {printersQuery.data?.map((printer) => (
            <Box
              key={printer.id}
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {printer.name}{' '}
                  <Chip size="small" label={usageLabels[printer.usage]} sx={{ ml: 1 }} />
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {printer.host}:{printer.port}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Switch
                  checked={printer.active}
                  title="Attiva/disattiva"
                  onChange={(e) =>
                    toggleActiveMutation.mutate({ id: printer.id, active: e.target.checked })
                  }
                />
                <IconButton title="Elimina" onClick={() => setToDelete(printer)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          ))}
          {printersQuery.data?.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nessuna stampante configurata.
            </Typography>
          )}
        </Stack>
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nuova stampante</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 2 }}>
          <TextField
            label="Nome"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <TextField
            label="Indirizzo IP"
            value={form.host}
            onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
          />
          <TextField
            label="Porta"
            type="number"
            value={form.port}
            onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
          />
          <TextField
            select
            label="Uso"
            value={form.usage}
            onChange={(e) => setForm((f) => ({ ...f, usage: e.target.value }))}
          >
            {Object.entries(usageLabels).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!form.name || !form.host || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Aggiungi
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        title="Eliminare la stampante?"
        message={toDelete ? `"${toDelete.name}" verrà eliminata definitivamente.` : ''}
        loading={deleteMutation.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />
    </Card>
  );
}
