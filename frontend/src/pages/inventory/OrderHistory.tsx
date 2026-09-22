import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

interface OrderLineRow {
  id: string;
  orderedQty: number;
  product: { name: string; unit: string; costPerUnit?: number };
}

interface OrderRow {
  id: string;
  status: 'DRAFT' | 'SENT' | 'CONFIRMED' | 'CLOSED';
  createdAt: string;
  sentAt?: string;
  supplier: { name: string };
  lines: OrderLineRow[];
}

const statusLabels: Record<OrderRow['status'], string> = {
  DRAFT: 'Bozza',
  SENT: 'Inviato',
  CONFIRMED: 'Confermato',
  CLOSED: 'Chiuso',
};

const statusColor: Record<OrderRow['status'], 'default' | 'warning' | 'success'> = {
  DRAFT: 'default',
  SENT: 'warning',
  CONFIRMED: 'success',
  CLOSED: 'default',
};

function orderTotal(order: OrderRow): number {
  return order.lines.reduce((sum, l) => sum + (l.product.costPerUnit ?? 0) * l.orderedQty, 0);
}

/** Storico degli ordini inviati ai fornitori, con dettaglio prodotti e totale (se i costi sono impostati). */
export function OrderHistory() {
  const [detail, setDetail] = useState<OrderRow | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['orders-history'],
    queryFn: async () => (await api.get<OrderRow[]>('/inventory/orders')).data,
  });

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Typography variant="h6">Storico ordini</Typography>
      <Stack spacing={1}>
        {ordersQuery.data?.map((order) => {
          const total = orderTotal(order);
          return (
            <Card key={order.id} variant="outlined">
              <CardContent
                sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setDetail(order)}
              >
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {order.supplier.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(order.createdAt).toLocaleDateString('it-IT')}
                    {total > 0 && ` — Totale € ${total.toFixed(2)}`}
                  </Typography>
                </Box>
                <Chip size="small" color={statusColor[order.status]} label={statusLabels[order.status]} />
              </CardContent>
            </Card>
          );
        })}
        {ordersQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessun ordine ancora effettuato.
          </Typography>
        )}
      </Stack>

      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detail?.supplier.name}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Prodotto</TableCell>
                  <TableCell>Quantità</TableCell>
                  <TableCell>Costo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {detail?.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.product.name}</TableCell>
                    <TableCell>
                      {line.orderedQty} {line.product.unit}
                    </TableCell>
                    <TableCell>
                      {line.product.costPerUnit != null
                        ? `€ ${(line.product.costPerUnit * line.orderedQty).toFixed(2)}`
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {detail && orderTotal(detail) > 0 && (
            <Typography variant="body2" sx={{ mt: 2, textAlign: 'right' }} fontWeight={600}>
              Totale: € {orderTotal(detail).toFixed(2)}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDetail(null)}>Chiudi</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
