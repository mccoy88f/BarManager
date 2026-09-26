import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Divider, Stack, Typography } from '@mui/material';
import { api } from '../../api/client';

type OnlineOrderStatus = 'PENDING' | 'CONFIRMED' | 'READY' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

interface TrackedLine {
  id: string;
  itemName: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  note?: string | null;
  modifiers: { optionName: string; price: number }[];
}

interface TrackedOrder {
  id: string;
  status: OnlineOrderStatus;
  fulfillment: 'PICKUP' | 'DELIVERY';
  paymentMethod: 'CASH' | 'CARD_ONLINE' | 'CARD_IN_STORE' | null;
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  requestedAt: string;
  proposedRequestedAt: string | null;
  deliveryAddress: string | null;
  rejectionReason: string | null;
  subtotal: number;
  deliveryFee: number;
  total: number;
  lines: TrackedLine[];
  venue?: {
    name: string;
    logoUrl: string | null;
    menuCoverUrl?: string | null;
  };
}

const STATUS_LABELS: Record<OnlineOrderStatus, string> = {
  PENDING: 'Ricevuto, in attesa di conferma',
  CONFIRMED: 'Confermato, in preparazione',
  READY: 'Pronto',
  COMPLETED: 'Completato',
  REJECTED: 'Rifiutato',
  CANCELLED: 'Annullato',
};

function paymentMethodLabel(method: string | null, fulfillment: string): string {
  if (method === 'CARD_ONLINE') return 'Carta (online)';
  if (method === 'CASH') return fulfillment === 'DELIVERY' ? 'Contanti alla consegna' : 'Contanti';
  if (method === 'CARD_IN_STORE') return 'Carta in negozio';
  if (fulfillment === 'PICKUP') return 'In negozio al ritiro (contanti o carta)';
  return 'Non specificato';
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Non è stato possibile completare la richiesta. Riprova più tardi.';
}

/**
 * Pagina pubblica di tracciamento ordine (§5.10 di DEVELOPMENT.md), nessun
 * login: raggiunta dal link mandato al cliente alla conferma dell'ordine
 * e in ogni email di stato successiva. Stesso pattern (id nel path, token
 * in query string) delle pagine analoghe di prenotazione.
 */
export function PublicOnlineOrderTrack() {
  const { id } = useParams<{ id: string }>();
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';

  const orderQuery = useQuery({
    queryKey: ['public-online-order-track', id, token],
    queryFn: async () =>
      (await api.get<TrackedOrder>(`/public/online-orders/${id}/manage`, { params: { token } })).data,
    enabled: !!id && !!token,
  });

  const confirmTimeMutation = useMutation({
    mutationFn: async () =>
      (await api.patch(`/public/online-orders/${id}/manage/confirm-time`, { token })).data,
    onSuccess: () => orderQuery.refetch(),
  });

  if (!id || !token) {
    return (
      <Box sx={{ textAlign: 'center', mt: 6 }}>
        <Typography>Link non valido.</Typography>
      </Box>
    );
  }

  if (orderQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (orderQuery.isError || !orderQuery.data) {
    return (
      <Box sx={{ textAlign: 'center', mt: 6 }}>
        <Typography>Ordine non trovato.</Typography>
      </Box>
    );
  }

  const order = orderQuery.data;
  const logo = order.venue?.logoUrl || order.venue?.menuCoverUrl;

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, py: 4 }}>
      {logo && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          <Box
            component="img"
            src={logo}
            alt={order.venue?.name || 'Logo del locale'}
            sx={{
              maxHeight: 80,
              maxWidth: 240,
              objectFit: 'contain',
              borderRadius: 1,
            }}
          />
        </Box>
      )}

      {order.venue?.name && (
        <Typography variant="subtitle1" color="text.secondary" textAlign="center" fontWeight={600}>
          {order.venue.name}
        </Typography>
      )}

      <Typography variant="h5" fontWeight={700} textAlign="center" gutterBottom>
        Il tuo ordine
      </Typography>

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent sx={{ display: 'grid', gap: 1.5 }}>
          <Alert severity={order.status === 'REJECTED' || order.status === 'CANCELLED' ? 'error' : 'info'}>
            {STATUS_LABELS[order.status]}
          </Alert>

          {order.rejectionReason && (
            <Typography variant="body2" color="text.secondary">
              Motivo: {order.rejectionReason}
            </Typography>
          )}

          {order.status === 'REJECTED' && order.paymentMethod === 'CARD_ONLINE' && (
            <Alert severity="info">
              I soldi sono stati stornati e torneranno sul metodo di pagamento originale secondo i tempi previsti dall'emittente della carta.
            </Alert>
          )}

          {order.proposedRequestedAt && (
            <Alert
              severity="warning"
              action={
                <Button
                  size="small"
                  color="inherit"
                  disabled={confirmTimeMutation.isPending}
                  onClick={() => confirmTimeMutation.mutate()}
                >
                  Confermo il nuovo orario
                </Button>
              }
            >
              Il locale propone di spostare {order.fulfillment === 'PICKUP' ? 'il ritiro' : 'la consegna'} a{' '}
              {formatWhen(order.proposedRequestedAt)}.
              {confirmTimeMutation.isSuccess && ' Confermato!'}
            </Alert>
          )}

          {confirmTimeMutation.isError && (
            <Alert severity="error">{extractErrorMessage(confirmTimeMutation.error)}</Alert>
          )}

          <Typography variant="body2">
            {order.fulfillment === 'PICKUP' ? 'Ritiro previsto' : 'Consegna prevista'}: {formatWhen(order.requestedAt)}
          </Typography>
          {order.deliveryAddress && (
            <Typography variant="body2" color="text.secondary">
              Indirizzo: {order.deliveryAddress}
            </Typography>
          )}

          <Divider />

          <Stack spacing={1}>
            {order.lines.map((line) => (
              <Box key={line.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    {line.quantity}× {line.itemName}
                    {line.variantName?.trim() ? ` (${line.variantName.trim()})` : ''}
                  </Typography>
                  {line.modifiers.map((m, idx) => (
                    <Typography key={idx} variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1 }}>
                      + {m.optionName}{m.price > 0 ? ` (+€ ${m.price.toFixed(2)})` : ''}
                    </Typography>
                  ))}
                  {line.note?.trim() && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1, fontStyle: 'italic' }}>
                      nota: {line.note.trim()}
                    </Typography>
                  )}
                </Box>
                <Typography variant="body2">
                  € {(line.quantity * (line.unitPrice + line.modifiers.reduce((s, m) => s + m.price, 0))).toFixed(2)}
                </Typography>
              </Box>
            ))}
          </Stack>

          <Divider />

          {order.fulfillment === 'DELIVERY' && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body2">Consegna</Typography>
              <Typography variant="body2">
                {order.deliveryFee > 0 ? `€ ${order.deliveryFee.toFixed(2)}` : 'Gratuita'}
              </Typography>
            </Box>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Totale
            </Typography>
            <Typography variant="subtitle1" fontWeight={700}>
              € {order.total.toFixed(2)}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2">Metodo di pagamento</Typography>
            <Typography variant="body2" fontWeight={600}>
              {paymentMethodLabel(order.paymentMethod, order.fulfillment)}
            </Typography>
          </Box>

          <Button onClick={() => orderQuery.refetch()}>Aggiorna stato</Button>
        </CardContent>
      </Card>
    </Box>
  );
}
