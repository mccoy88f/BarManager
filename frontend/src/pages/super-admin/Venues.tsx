import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

interface Venue {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: string;
  _count: { users: number };
}

/** Pannello Super Admin: elenco locali, creazione nuovo locale + primo admin. */
export function Venues() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const venuesQuery = useQuery({
    queryKey: ['venues'],
    queryFn: async () => (await api.get<Venue[]>('/venues')).data,
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/venues', { name, slug, adminEmail, adminPassword })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venues'] });
      setName('');
      setSlug('');
      setAdminEmail('');
      setAdminPassword('');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch(`/venues/${id}/active`, { active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['venues'] }),
  });

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
                <Switch
                  checked={v.active}
                  onChange={(e) =>
                    toggleActiveMutation.mutate({ id: v.id, active: e.target.checked })
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
