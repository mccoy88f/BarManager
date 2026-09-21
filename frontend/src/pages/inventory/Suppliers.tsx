import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

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
export function Suppliers() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', phone: '' });

  const suppliersQuery = useQuery({
    queryKey: ['suppliers-admin'],
    queryFn: async () => (await api.get<SupplierRow[]>('/inventory/suppliers')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['suppliers-admin'] });

  const createMutation = useMutation({
    mutationFn: async () => (await api.post('/inventory/suppliers', form)).data,
    onSuccess: () => {
      invalidate();
      setForm({ name: '', email: '', phone: '' });
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

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Nuovo fornitore
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr 1fr' } }}>
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
          </Box>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={!form.name || !form.email || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Aggiungi
          </Button>
        </CardContent>
      </Card>

      <Typography variant="h6">Fornitori</Typography>
      <Stack spacing={2}>
        {suppliersQuery.data?.map((supplier) => (
          <Card key={supplier.id} variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600}>
                {supplier.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {supplier.email} {supplier.phone && `— ${supplier.phone}`}
              </Typography>
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
      </Stack>
    </Box>
  );
}
