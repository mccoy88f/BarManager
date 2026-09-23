import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
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

/** Storico degli ordini inviati ai fornitori: clic su un ordine apre il dettaglio a pagina intera. */
export function OrderHistory() {
  const navigate = useNavigate();

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
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  justifyContent: 'space-between',
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  gap: 1,
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/inventory/orders-history/${order.id}`)}
              >
                <Box sx={{ minWidth: 0 }}>
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
    </Box>
  );
}
