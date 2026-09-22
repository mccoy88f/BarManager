import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
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
import { deliverPrintJob, type PrintJobResponse } from '../../printing/printJob';

type PrinterUsage = 'HACCP' | 'ORDERS' | 'GENERIC';

interface PrinterRow {
  id: string;
  name: string;
  host: string;
  port: number;
  usages: PrinterUsage[];
  active: boolean;
}

const usageLabels: Record<PrinterUsage, string> = {
  HACCP: 'Report HACCP',
  ORDERS: 'Checklist ordini',
  GENERIC: 'Generico',
};

const emptyForm = { name: '', host: '', port: '9100', usages: ['GENERIC'] as PrinterUsage[] };

const testFailureLabels: Record<string, string> = {
  NOT_FOUND: 'Stampante non trovata.',
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
        usages: form.usages,
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
    mutationFn: async (printer: PrinterRow) => {
      const job = (await api.post<PrintJobResponse>(`/printers/${printer.id}/test`)).data;
      return { printer, outcome: await deliverPrintJob(job) };
    },
    onSuccess: ({ printer, outcome }) =>
      setTestResult({
        printerId: printer.id,
        printerName: printer.name,
        printed: outcome.printed,
        reason: outcome.reason,
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
      usages: printer.usages,
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
          Usate per il report HACCP giornaliero e la checklist degli ordini fornitori. La stampa
          parte dal browser con la stampa standard del dispositivo: su PC usa la stampante di
          sistema, su Android serve un'app come{' '}
          <a
            href="https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter"
            target="_blank"
            rel="noopener noreferrer"
          >
            RawBT
          </a>{' '}
          per collegare la stampante ESC/POS di rete al dialogo di stampa.
        </Typography>

        {testResult && (
          <Alert
            severity={testResult.printed ? 'success' : 'error'}
            sx={{ mt: 1 }}
            onClose={() => setTestResult(null)}
          >
            {testResult.printed
              ? `Dialogo di stampa aperto per "${testResult.printerName}".`
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
                <Typography variant="body2" fontWeight={600} component="div">
                  {printer.name}{' '}
                  {printer.usages.map((usage) => (
                    <Chip key={usage} size="small" label={usageLabels[usage]} sx={{ ml: 1 }} />
                  ))}
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
          <FormControl>
            <InputLabel id="printer-usages-label" shrink>
              Uso
            </InputLabel>
            <Select
              multiple
              labelId="printer-usages-label"
              label="Uso"
              value={form.usages}
              onChange={(e) => {
                const value = e.target.value;
                setForm((f) => ({
                  ...f,
                  usages: typeof value === 'string' ? (value.split(',') as PrinterUsage[]) : value,
                }));
              }}
              renderValue={(selected) => selected.map((v) => usageLabels[v]).join(', ')}
            >
              {(Object.entries(usageLabels) as [PrinterUsage, string][]).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  <Checkbox checked={form.usages.includes(value)} />
                  <ListItemText primary={label} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!form.name || !form.host || form.usages.length === 0 || saveMutation.isPending}
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
