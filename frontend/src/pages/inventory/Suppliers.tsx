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
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

interface SupplierRow {
  id: string;
  name: string;
  email: string;
  phone?: string;
  orderDays: number[];
}

const weekdays = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mer' },
  { value: 4, label: 'Gio' },
  { value: 5, label: 'Ven' },
  { value: 6, label: 'Sab' },
  { value: 7, label: 'Dom' },
];

/**
 * Anagrafica fornitori: qui si impostano anche i giorni ricorrenti in cui
 * va fatto l'ordine (es. lunedì e giovedì), usati per il promemoria in home.
 */
function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio del fornitore. Controlla i dati inseriti.';
}

export function Suppliers() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<SupplierRow | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ['suppliers-admin'],
    queryFn: async () => (await api.get<SupplierRow[]>('/inventory/suppliers')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['suppliers-admin'] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
      };
      return editing
        ? (await api.patch(`/inventory/suppliers/${editing.id}`, payload)).data
        : (await api.post('/inventory/suppliers', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      showToast(editing ? 'Fornitore aggiornato' : 'Fornitore creato');
      setForm({ name: '', email: '', phone: '' });
      setError(null);
      setOpen(false);
      setEditing(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/inventory/suppliers/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setSupplierToDelete(null);
      showToast('Fornitore eliminato');
    },
  });

  const toggleOrderDayMutation = useMutation({
    mutationFn: async ({ supplier, day }: { supplier: SupplierRow; day: number }) => {
      const orderDays = supplier.orderDays.includes(day)
        ? supplier.orderDays.filter((d) => d !== day)
        : [...supplier.orderDays, day];
      return (await api.patch(`/inventory/suppliers/${supplier.id}`, { orderDays })).data;
    },
    onSuccess: invalidate,
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', email: '', phone: '' });
    setError(null);
    setOpen(true);
  };

  const openEdit = (supplier: SupplierRow) => {
    setEditing(supplier);
    setForm({ name: supplier.name, email: supplier.email, phone: supplier.phone ?? '' });
    setError(null);
    setOpen(true);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Fornitori</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Aggiungi
        </Button>
      </Box>
      <Stack spacing={2}>
        {suppliersQuery.data?.map((supplier) => (
          <Card key={supplier.id} variant="outlined">
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {supplier.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {supplier.email} {supplier.phone && `— ${supplier.phone}`}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.5}>
                  <IconButton size="small" title="Modifica" onClick={() => openEdit(supplier)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" title="Elimina" onClick={() => setSupplierToDelete(supplier)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Giorni ordine ricorrenti:
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                {weekdays.map((day) => {
                  const active = supplier.orderDays.includes(day.value);
                  return (
                    <Chip
                      key={day.value}
                      label={day.label}
                      size="small"
                      color={active ? 'primary' : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      onClick={() => toggleOrderDayMutation.mutate({ supplier, day: day.value })}
                    />
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        ))}
        {suppliersQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessun fornitore censito.
          </Typography>
        )}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Modifica fornitore' : 'Nuovo fornitore'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 3 }}>
          <TextField
            label="Nome"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
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
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!form.name || !form.email || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {editing ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!supplierToDelete}
        title="Eliminare il fornitore?"
        message={
          supplierToDelete
            ? `"${supplierToDelete.name}" non sarà più selezionabile per nuovi prodotti o ordini. Lo storico ordini resta invariato.`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => setSupplierToDelete(null)}
        onConfirm={() => supplierToDelete && deleteMutation.mutate(supplierToDelete.id)}
      />
    </Box>
  );
}
