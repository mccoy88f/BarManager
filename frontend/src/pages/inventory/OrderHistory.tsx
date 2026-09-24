import { Box, Card, CardContent, Chip, Stack, Tooltip, Typography } from '@mui/material';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { PENDING_CHIP_COLOR, SUCCESS_CHIP_COLOR, NEUTRAL_CHIP_COLOR } from '../../config/statusChip';

interface OrderLineRow {
  id: string;
  orderedQty: number;
  product: { name: string; unit: string; costPerUnit?: number };
}

export interface OrderRow {
  id: string;
  status: 'DRAFT' | 'SENT' | 'CONFIRMED' | 'CLOSED';
  createdAt: string;
  sentAt?: string;
  emailSent?: boolean | null;
  emailError?: string | null;
  supplier: { name: string };
  lines: OrderLineRow[];
}

export function EmailStatusIndicator({
  emailSent,
  emailError,
}: {
  emailSent?: boolean | null;
  emailError?: string | null;
}) {
  if (emailSent == null) return null;
  if (emailSent) {
    return (
      <Tooltip title="Email inviata al fornitore">
        <MarkEmailReadIcon color="success" fontSize="small" />
      </Tooltip>
    );
  }
  return (
    <Tooltip title={emailError ? `Invio email non riuscito: ${emailError}` : 'Invio email non riuscito'}>
      <ErrorOutlineIcon color="error" fontSize="small" />
    </Tooltip>
  );
}

export const statusLabels: Record<OrderRow['status'], string> = {
  DRAFT: 'Bozza',
  SENT: 'Inviato',
  CONFIRMED: 'Confermato',
  CLOSED: 'Chiuso',
};

export const statusColor: Record<OrderRow['status'], 'default' | 'warning' | 'success'> = {
  DRAFT: NEUTRAL_CHIP_COLOR,
  SENT: PENDING_CHIP_COLOR,
  CONFIRMED: SUCCESS_CHIP_COLOR,
  CLOSED: NEUTRAL_CHIP_COLOR,
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
                <Stack direction="row" spacing={1} alignItems="center">
                  <EmailStatusIndicator emailSent={order.emailSent} emailError={order.emailError} />
                  <Chip size="small" color={statusColor[order.status]} label={statusLabels[order.status]} />
                </Stack>
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
