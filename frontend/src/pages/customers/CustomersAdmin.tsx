import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  notes: string | null;
  marketingConsent: boolean;
  firstReservationAt: string | null;
  lastReservationAt: string | null;
  reservationsCount: number;
}

interface ImportResult {
  created: number;
  updated: number;
  errors: string[];
}

const emptyForm = { firstName: '', lastName: '', email: '', phone: '', notes: '' };
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio del cliente. Controlla i dati inseriti.';
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('it-IT') : '—';
}

/**
 * Anagrafica clienti (§5.8 di DEVELOPMENT.md): creata/aggiornata in automatico
 * a ogni prenotazione, ma gestibile anche a mano qui (CRUD completo, tranne
 * il consenso marketing — v. sotto), oltre a importazione/esportazione
 * massiva in xlsx (stesso formato in entrambe le direzioni: colonne per
 * intestazione, non per posizione). Le date di prima/ultima prenotazione
 * sono di sola lettura quando derivano dalle prenotazioni (calcolate dal
 * backend): "ultima prenotazione" è pensata anche come riferimento per un
 * futuro invio di campagne (email/SMS/WhatsApp), non ancora implementato.
 * Il consenso marketing è di sola lettura anche qui in pagina (solo un
 * Chip, mai un controllo editabile): può essere dato o ritirato solo dal
 * cliente stesso, alla prenotazione o dalla pagina pubblica "gestisci i
 * tuoi dati personali" — mai dallo staff (v. nota su CreateCustomerDto/
 * UpdateCustomerDto nel backend). Ricerca (nome/cognome/email/telefono) e
 * paginazione (10/25/50/100 righe) sono interamente lato client: la lista
 * completa arriva già da /customers in un'unica chiamata.
 */
export function CustomersAdmin() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await api.get<Customer[]>('/customers')).data,
  });

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customersQuery.data ?? [];
    return (customersQuery.data ?? []).filter((c) =>
      [c.firstName, c.lastName, c.email, c.phone ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [customersQuery.data, search]);

  const paginatedCustomers = useMemo(
    () => filteredCustomers.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filteredCustomers, page, rowsPerPage],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['customers'] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      return editing
        ? (await api.patch(`/customers/${editing.id}`, payload)).data
        : (await api.post('/customers', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      showToast(editing ? 'Cliente aggiornato' : 'Cliente creato');
      setForm(emptyForm);
      setError(null);
      setOpen(false);
      setEditing(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/customers/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setCustomerToDelete(null);
      showToast('Cliente eliminato');
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => (await api.get('/customers/export/xlsx', { responseType: 'blob' })).data,
    onSuccess: (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'clienti.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: () => showToast('Esportazione non riuscita'),
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return (await api.post<ImportResult>('/customers/import/xlsx', body)).data;
    },
    onSuccess: (result) => {
      invalidate();
      setImportErrors(result.errors.length ? result.errors : null);
      showToast(`Importazione completata: ${result.created} creati, ${result.updated} aggiornati`);
    },
    onError: () => showToast('Importazione non riuscita: controlla il formato del file'),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setForm({
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone ?? '',
      notes: customer.notes ?? '',
    });
    setError(null);
    setOpen(true);
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importMutation.mutate(file);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">Clienti</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<FileDownloadIcon />}
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            Esporta
          </Button>
          <Button
            variant="outlined"
            startIcon={<FileUploadIcon />}
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
          >
            Importa
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            hidden
            onChange={handleImportFileChange}
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Aggiungi
          </Button>
        </Box>
      </Box>

      {importErrors && (
        <Alert severity="warning" onClose={() => setImportErrors(null)}>
          Alcune righe non sono state importate:
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {importErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </Alert>
      )}

      <TextField
        placeholder="Cerca per nome, cognome, email o telefono…"
        size="small"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
        sx={{ maxWidth: 420 }}
      />

      <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nome</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Telefono</TableCell>
              <TableCell align="center">Marketing</TableCell>
              <TableCell align="center">Prenotazioni</TableCell>
              <TableCell>Registrato il</TableCell>
              <TableCell>Ultima prenotazione</TableCell>
              <TableCell align="right">Azioni</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedCustomers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  {customer.firstName} {customer.lastName}
                </TableCell>
                <TableCell>{customer.email}</TableCell>
                <TableCell>{customer.phone || '—'}</TableCell>
                <TableCell align="center">
                  <Chip
                    size="small"
                    label={customer.marketingConsent ? 'Sì' : 'No'}
                    color={customer.marketingConsent ? 'success' : 'default'}
                    title="Consenso gestito solo dal cliente (prenotazione o pagina dati personali): qui è di sola lettura"
                  />
                </TableCell>
                <TableCell align="center">
                  <Chip size="small" label={customer.reservationsCount} />
                </TableCell>
                <TableCell>{formatDate(customer.firstReservationAt)}</TableCell>
                <TableCell>{formatDate(customer.lastReservationAt)}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" title="Modifica" onClick={() => openEdit(customer)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" title="Elimina" onClick={() => setCustomerToDelete(customer)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={filteredCustomers.length}
          page={page}
          onPageChange={(_e, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(Number(e.target.value));
            setPage(0);
          }}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
          labelRowsPerPage="Righe per pagina"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} di ${count}`}
        />
      </TableContainer>
      {customersQuery.data?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Nessun cliente ancora registrato: verranno aggiunti automaticamente con la prima prenotazione, oppure puoi inserirli a mano o importarli da xlsx.
        </Typography>
      )}
      {customersQuery.data && customersQuery.data.length > 0 && filteredCustomers.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Nessun cliente corrisponde alla ricerca.
        </Typography>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Modifica cliente' : 'Nuovo cliente'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
          <TextField
            label="Nome"
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
          />
          <TextField
            label="Cognome"
            value={form.lastName}
            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <TextField
            label="Telefono"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <TextField
            label="Note"
            multiline
            minRows={2}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          {editing && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Consenso marketing:
              </Typography>
              <Chip
                size="small"
                label={editing.marketingConsent ? 'Sì' : 'No'}
                color={editing.marketingConsent ? 'success' : 'default'}
              />
              <Typography variant="caption" color="text.secondary">
                (solo il cliente può attivarlo/disattivarlo, alla prenotazione o dalla pagina "gestisci i tuoi dati personali")
              </Typography>
            </Box>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!form.firstName || !form.lastName || !form.email || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {editing ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!customerToDelete}
        title="Eliminare il cliente?"
        message={
          customerToDelete
            ? `"${customerToDelete.firstName} ${customerToDelete.lastName}" verrà rimosso dall'anagrafica. Le prenotazioni già registrate restano invariate.`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => setCustomerToDelete(null)}
        onConfirm={() => customerToDelete && deleteMutation.mutate(customerToDelete.id)}
      />
    </Box>
  );
}
