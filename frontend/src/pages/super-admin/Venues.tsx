import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Switch,
  Alert,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface Venue {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: string;
  _count: { users: number };
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Pannello Super Admin: elenco locali, creazione nuovo locale + primo admin. */
export function Venues() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [editing, setEditing] = useState<Venue | null>(null);
  const [editForm, setEditForm] = useState({ name: '', slug: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [venueToSuspend, setVenueToSuspend] = useState<Venue | null>(null);

  const venuesQuery = useQuery({
    queryKey: ['venues'],
    queryFn: async () => (await api.get<Venue[]>('/venues')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['venues'] });

  const createMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/venues', { name, slug, adminEmail, adminPassword })).data,
    onSuccess: () => {
      invalidate();
      setName('');
      setSlug('');
      setAdminEmail('');
      setAdminPassword('');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch(`/venues/${id}/active`, { active })).data,
    onSuccess: () => {
      invalidate();
      setVenueToSuspend(null);
    },
  });

  const editMutation = useMutation({
    mutationFn: async () =>
      (await api.patch(`/venues/${editing!.id}`, editForm)).data,
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setEditError(null);
    },
    onError: (err) => setEditError(extractErrorMessage(err)),
  });

  const openEdit = (venue: Venue) => {
    setEditing(venue);
    setEditForm({ name: venue.name, slug: venue.slug });
    setEditError(null);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Nuovo locale
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
            <TextField label="Nome locale" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField
              label="Sotto-dominio"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              helperText={slug ? `${slug}.tuodominio.it` : 'es. locale-centro'}
            />
            <TextField
              label="Email amministratore"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
            <TextField
              label="Password provvisoria"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
          </Box>
          {createMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Errore nella creazione (sotto-dominio già in uso?)
            </Alert>
          )}
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={
              !name || !slug || !adminEmail || !adminPassword || createMutation.isPending
            }
            onClick={() => createMutation.mutate()}
          >
            Crea locale
          </Button>
        </CardContent>
      </Card>

      <Typography variant="h6">Locali</Typography>
      <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Nome</TableCell>
            <TableCell>Sotto-dominio</TableCell>
            <TableCell>Utenti</TableCell>
            <TableCell>Stato</TableCell>
            <TableCell align="right">Attivo</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {venuesQuery.data?.map((v) => (
            <TableRow key={v.id}>
              <TableCell>{v.name}</TableCell>
              <TableCell>{v.slug}</TableCell>
              <TableCell>{v._count.users}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={v.active ? 'Attivo' : 'Sospeso'}
                  color={v.active ? 'success' : 'default'}
                />
              </TableCell>
              <TableCell align="right">
                <IconButton size="small" title="Modifica" onClick={() => openEdit(v)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <Switch
                  checked={v.active}
                  title={v.active ? 'Sospendi locale' : 'Riattiva locale'}
                  onChange={(e) =>
                    e.target.checked
                      ? toggleActiveMutation.mutate({ id: v.id, active: true })
                      : setVenueToSuspend(v)
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Modifica locale</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 3 }}>
          <TextField
            label="Nome locale"
            value={editForm.name}
            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
          />
          <TextField
            label="Sotto-dominio"
            value={editForm.slug}
            onChange={(e) => setEditForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
          />
          {editError && <Alert severity="error">{editError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setEditing(null)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!editForm.name.trim() || !editForm.slug.trim() || editMutation.isPending}
            onClick={() => editMutation.mutate()}
          >
            Salva
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!venueToSuspend}
        title="Sospendere il locale?"
        message={
          venueToSuspend
            ? `Nessun utente di "${venueToSuspend.name}" potrà più accedere finché non lo riattivi. Tutti i dati restano intatti.`
            : ''
        }
        confirmLabel="Sospendi"
        loading={toggleActiveMutation.isPending}
        onCancel={() => setVenueToSuspend(null)}
        onConfirm={() =>
          venueToSuspend && toggleActiveMutation.mutate({ id: venueToSuspend.id, active: false })
        }
      />
    </Box>
  );
}
