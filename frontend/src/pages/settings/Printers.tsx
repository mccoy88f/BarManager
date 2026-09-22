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
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PrintIcon from '@mui/icons-material/Print';
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

const testFailureLabels: Record<string, string> = {
  NOT_FOUND: 'Stampante non trovata.',
  PRINTER_UNREACHABLE: 'Stampante irraggiungibile: verifica indirizzo IP, porta e che sia accesa.',
  PRINT_ERROR: "Errore durante l'invio della stampa.",
};

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
  const [editing, setEditing] = useState<PrinterRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<PrinterRow | null>(null);
  const [testResult, setTestResult] = useState<{
    printerId: string;
    printerName: string;
    printed: boolean;
    reason?: string;
  } | null>(null);

  const printersQuery = useQuery({
    queryKey: ['printers'],
    queryFn: async () => (await api.get<PrinterRow[]>('/printers')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['printers'] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port),
        usage: form.usage,
      };
      return editing
        ? (await api.patch(`/printers/${editing.id}`, payload)).data
        : (await api.post('/printers', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      setForm(emptyForm);
      setError(null);
      setOpen(false);
      setEditing(null);
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

  const testMutation = useMutation({
    mutationFn: async (printer: PrinterRow) => ({
      printer,
      result: (await api.post<{ printed: boolean; reason?: string }>(`/printers/${printer.id}/test`))
        .data,
    }),
    onSuccess: ({ printer, result }) =>
      setTestResult({
        printerId: printer.id,
        printerName: printer.name,
        printed: result.printed,
        reason: result.reason,
      }),
    onError: (_err, printer) =>
      setTestResult({ printerId: printer.id, printerName: printer.name, printed: false }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  };

  const openEdit = (printer: PrinterRow) => {
    setEditing(printer);
    setForm({
      name: printer.name,
      host: printer.host,
      port: String(printer.port),
      usage: printer.usage,
    });
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

        {testResult && (
          <Alert
            severity={testResult.printed ? 'success' : 'error'}
            sx={{ mt: 1 }}
            onClose={() => setTestResult(null)}
          >
            {testResult.printed
              ? `Ricevuta di prova inviata a "${testResult.printerName}".`
              : `"${testResult.printerName}": ${
                  testFailureLabels[testResult.reason ?? ''] ?? 'Test di stampa non riuscito.'
                }`}
          </Alert>
        )}

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
                <IconButton
                  title="Test di stampa"
                  disabled={testMutation.isPending}
                  onClick={() => {
                    setTestResult(null);
                    testMutation.mutate(printer);
                  }}
                >
                  <PrintIcon fontSize="small" />
                </IconButton>
                <IconButton title="Modifica" onClick={() => openEdit(printer)}>
                  <EditIcon fontSize="small" />
                </IconButton>
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
        <DialogTitle>{editing ? 'Modifica stampante' : 'Nuova stampante'}</DialogTitle>
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
            InputLabelProps={{ shrink: true }}
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
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!form.name || !form.host || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {editing ? 'Salva' : 'Aggiungi'}
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
