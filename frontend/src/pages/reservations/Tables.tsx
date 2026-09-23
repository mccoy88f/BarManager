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
  Switch,
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

interface TableRow {
  id: string;
  label: string;
  seats: number;
  active: boolean;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio del tavolo. Controlla i dati inseriti.';
}

/**
 * Censimento tavoli (§5.7): "active: false" ritira un tavolo dalle nuove
 * prenotazioni senza eliminarlo, mantenendo lo storico di quelle già
 * assegnate. L'eliminazione va usata solo per correggere un tavolo aggiunto
 * per errore.
 */
export function Tables() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TableRow | null>(null);
  const [form, setForm] = useState({ label: '', seats: '' });
  const [error, setError] = useState<string | null>(null);
  const [tableToDelete, setTableToDelete] = useState<TableRow | null>(null);

  const tablesQuery = useQuery({
    queryKey: ['reservations-tables'],
    queryFn: async () => (await api.get<TableRow[]>('/reservations/tables')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['reservations-tables'] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { label: form.label.trim(), seats: Number(form.seats) };
      return editing
        ? (await api.patch(`/reservations/tables/${editing.id}`, payload)).data
        : (await api.post('/reservations/tables', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      showToast(editing ? 'Tavolo aggiornato' : 'Tavolo creato');
      setForm({ label: '', seats: '' });
      setError(null);
      setOpen(false);
      setEditing(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (table: TableRow) =>
      (await api.patch(`/reservations/tables/${table.id}`, { active: !table.active })).data,
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/reservations/tables/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setTableToDelete(null);
      showToast('Tavolo eliminato');
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ label: '', seats: '' });
    setError(null);
    setOpen(true);
  };

  const openEdit = (table: TableRow) => {
    setEditing(table);
    setForm({ label: table.label, seats: String(table.seats) });
    setError(null);
    setOpen(true);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">Tavoli</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Aggiungi
        </Button>
      </Box>
      <Stack spacing={2}>
        {tablesQuery.data?.map((table) => (
          <Card key={table.id} variant="outlined" sx={{ opacity: table.active ? 1 : 0.6 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {table.label}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} alignItems="center">
                    <Chip size="small" label={`${table.seats} posti`} />
                    {!table.active && <Chip size="small" color="default" label="Ritirato" />}
                  </Stack>
                </Box>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Switch
                    checked={table.active}
                    onChange={() => toggleActiveMutation.mutate(table)}
                    title={table.active ? 'Ritira dalle nuove prenotazioni' : 'Riattiva'}
                  />
                  <IconButton size="small" title="Modifica" onClick={() => openEdit(table)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" title="Elimina" onClick={() => setTableToDelete(table)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Box>
            </CardContent>
          </Card>
        ))}
        {tablesQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessun tavolo censito.
          </Typography>
        )}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Modifica tavolo' : 'Nuovo tavolo'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
          <TextField
            label="Numero o nome"
            placeholder='es. "12" o "Terrazza 2"'
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
          <TextField
            label="Posti"
            type="number"
            value={form.seats}
            onChange={(e) => setForm((f) => ({ ...f, seats: e.target.value }))}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!form.label || !form.seats || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {editing ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!tableToDelete}
        title="Eliminare il tavolo?"
        message={
          tableToDelete
            ? `"${tableToDelete.label}" non sarà più selezionabile per nuove prenotazioni. Per ritirarlo temporaneamente senza perdere lo storico, usa l'interruttore invece di eliminarlo.`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => setTableToDelete(null)}
        onConfirm={() => tableToDelete && deleteMutation.mutate(tableToDelete.id)}
      />
    </Box>
  );
}
