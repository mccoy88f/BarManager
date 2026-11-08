import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
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
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';
import { shareReceiptPdf } from '../../printing/printJob';
import { printOrShare, isNativeApp } from '../../printing/nativePrint';
import { formatErrorMessage } from '../../utils/format';

type PrinterUsage =
  | 'SUPPLIER_ORDER'
  | 'ONLINE_ORDER_KITCHEN_TICKET'
  | 'ONLINE_ORDER_RECEIPT'
  | 'HACCP_REPORT'
  | 'EXPENSES_REPORT';

interface PrinterRow {
  id: string;
  name: string;
  host: string;
  port: number;
  usages: PrinterUsage[];
  active: boolean;
}

/** Un valore per ciascun documento stampabile: l'admin assegna liberamente una o più stampanti a ciascun tipo (§5.11 di docs/DEVELOPMENT.md). */
const usageLabels: Record<PrinterUsage, string> = {
  SUPPLIER_ORDER: 'Checklist ordini fornitori',
  ONLINE_ORDER_KITCHEN_TICKET: 'Comanda cucina (ordini online)',
  ONLINE_ORDER_RECEIPT: 'Scontrino ordini online',
  HACCP_REPORT: 'Report HACCP',
  EXPENSES_REPORT: 'Report Spese',
};

const emptyForm = { name: '', host: '', port: '9100', usages: [] as PrinterUsage[] };

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
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PrinterRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<PrinterRow | null>(null);
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    open: boolean;
    success: boolean;
    printerName: string;
    host: string;
    port: number;
    message: string;
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
      showToast(editing ? 'Stampante aggiornata' : 'Stampante creata');
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
    onSuccess: (_data, { active }) => {
      invalidate();
      showToast(active ? 'Stampante attivata' : 'Stampante disattivata');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/printers/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      showToast('Stampante eliminata');
    },
  });

  const testMutation = useMutation({
    mutationFn: async (printer: PrinterRow) => {
      setTestingPrinterId(printer.id);
      await printOrShare({
        escposUrl: `/printers/${printer.id}/test/escpos`,
        explicitPrinter: { host: printer.host, port: printer.port },
        printPdf: async () => {
          const response = await api.post(`/printers/${printer.id}/test`, undefined, {
            responseType: 'blob',
          });
          await shareReceiptPdf(response.data, `Test di stampa - ${printer.name}`);
        },
      });
      return printer;
    },
    onSuccess: (printer) => {
      const isNative = isNativeApp();
      setTestResult({
        open: true,
        success: true,
        printerName: printer.name,
        host: printer.host,
        port: printer.port,
        message: isNative
          ? `Comando di stampa ESC/POS inviato con successo a "${printer.name}" (${printer.host}:${printer.port}).`
          : `Test di stampa inviato a "${printer.name}" (anteprima PDF generata).`,
      });
    },
    onError: (err, printer) => {
      const detail = formatErrorMessage(err);
      setTestResult({
        open: true,
        success: false,
        printerName: printer.name,
        host: printer.host,
        port: printer.port,
        message: detail,
      });
    },
    onSettled: () => {
      setTestingPrinterId(null);
    },
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
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6">Stampanti di rete</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Aggiungi
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Assegna a ciascuna stampante uno o più tipi di documento (una stampante può servirne
          più di uno insieme, e lo stesso documento può andare a più stampanti).
        </Typography>
        <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          {isNativeApp() ? (
            <Chip size="small" color="success" label="App Android: Stampa diretta ESC/POS attiva" />
          ) : (
            <Chip size="small" color="default" label="Modalità Web / PWA: condivisione PDF" />
          )}
        </Box>
        <Alert severity="info" sx={{ mb: 2 }}>
          Host e porta configurati qui servono solo alla stampa diretta via rete locale (LAN)
          dell'app Android nativa <strong>BarManager</strong> — scaricala dalla pagina delle{' '}
          <a
            href="https://github.com/mccoy88f/BarManager/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
          >
            Release su GitHub
          </a>
          . Da sito e PWA la stampa parte invece dal dialogo di stampa standard del dispositivo:
          su PC usa la stampante di sistema, su Android serve un'app come{' '}
          <a
            href="https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter"
            target="_blank"
            rel="noopener noreferrer"
          >
            RawBT
          </a>{' '}
          per collegare la stampante ESC/POS di rete al dialogo di stampa.
        </Alert>

        <Stack spacing={1} sx={{ mt: 2 }}>
          {printersQuery.data?.map((printer) => (
            <Box
              key={printer.id}
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', sm: 'center' },
                gap: 1,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
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
                  size="small"
                  title="Test di stampa"
                  disabled={testMutation.isPending}
                  onClick={() => testMutation.mutate(printer)}
                >
                  {testingPrinterId === printer.id ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : (
                    <PrintIcon fontSize="small" />
                  )}
                </IconButton>
                <IconButton size="small" title="Modifica" onClick={() => openEdit(printer)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" title="Elimina" onClick={() => setToDelete(printer)}>
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
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
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

      <Dialog
        open={!!testResult?.open}
        onClose={() => setTestResult(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {testResult?.success ? (
            <CheckCircleOutlineIcon color="success" />
          ) : (
            <ErrorOutlineIcon color="error" />
          )}
          {testResult?.success ? 'Test di stampa riuscito' : 'Test di stampa non riuscito'}
        </DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <Typography variant="body2" component="div">
            Stampante: <strong>{testResult?.printerName}</strong> ({testResult?.host}:{testResult?.port})
          </Typography>
          {testResult?.success ? (
            <>
              <Alert severity="success">{testResult.message}</Alert>
              <Typography variant="caption" color="text.secondary">
                Se la stampante non ha espulso lo scontrino, verifica che sia accesa, che ci sia carta termica a sufficienza e che il rotolo sia inserito correttamente.
              </Typography>
            </>
          ) : (
            <>
              <Alert severity="error">
                <strong>Dettaglio errore:</strong> {testResult?.message}
              </Alert>
              <Alert severity="warning">
                <Typography variant="body2" fontWeight={600} gutterBottom>
                  Possibili cause e verifiche consigliate:
                </Typography>
                <Box component="ul" sx={{ pl: 2, m: 0, '& li': { mb: 0.5 } }}>
                  <li>
                    <strong>Connessione Wi-Fi:</strong> Il tablet o smartphone deve essere collegato alla stessa rete Wi-Fi del locale dove si trova la stampante (disattiva la connessione dati mobili 4G/5G).
                  </li>
                  <li>
                    <strong>Isolamento client / AP Isolation:</strong> Su alcuni router Wi-Fi è attiva la funzione che impedisce ai dispositivi senza fili di comunicare con la rete LAN/Ethernet locale.
                  </li>
                  <li>
                    <strong>Indirizzo IP e porta:</strong> Verifica che l'IP ({testResult?.host}) e la porta ({testResult?.port}) corrispondano alla configurazione della stampante e che sia accesa.
                  </li>
                </Box>
              </Alert>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={() => setTestResult(null)}>
            Chiudi
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
