import { useMemo, useState } from 'react';
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
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import DirectionsIcon from '@mui/icons-material/Directions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { QuarterHourTimeField } from '../../components/QuarterHourTimeField';
import { useToast } from '../../components/ToastProvider';
import { PENDING_CHIP_COLOR, SUCCESS_CHIP_COLOR, NEUTRAL_CHIP_COLOR } from '../../config/statusChip';

type OnlineOrderStatus = 'PENDING' | 'CONFIRMED' | 'READY' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
type Fulfillment = 'PICKUP' | 'DELIVERY';

interface OrderLine {
  id: string;
  itemName: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  note: string | null;
  modifiers: { optionName: string; price: number }[];
}

interface OrderRow {
  id: string;
  status: OnlineOrderStatus;
  fulfillment: Fulfillment;
  requestedAt: string;
  proposedRequestedAt: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  deliveryAddress: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  subtotal: number;
  deliveryFee: number;
  total: number;
  lines: OrderLine[];
}

const QUEUE_TABS: OnlineOrderStatus[] = ['PENDING', 'CONFIRMED', 'READY'];

const tabLabels: Record<OnlineOrderStatus, string> = {
  PENDING: 'Da confermare',
  CONFIRMED: 'In preparazione',
  READY: 'Pronti',
  COMPLETED: 'Completati',
  REJECTED: 'Rifiutati',
  CANCELLED: 'Annullati',
};

const statusColors: Record<OnlineOrderStatus, 'warning' | 'success' | 'default'> = {
  PENDING: PENDING_CHIP_COLOR,
  CONFIRMED: SUCCESS_CHIP_COLOR,
  READY: SUCCESS_CHIP_COLOR,
  COMPLETED: NEUTRAL_CHIP_COLOR,
  REJECTED: NEUTRAL_CHIP_COLOR,
  CANCELLED: NEUTRAL_CHIP_COLOR,
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('it-IT')} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return "Errore durante l'aggiornamento dell'ordine.";
}

function navigateUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/**
 * Coda ordini online (§5.10 di DEVELOPMENT.md): tre schede — Da
 * confermare, In preparazione, Pronti — stesso schema a tab della coda
 * prenotazioni. Le stampe dei due scontrini (comanda cucina/scontrino
 * completo) e la sincronizzazione Loyverse arrivano in una fase
 * successiva (§5.10), non ancora collegate qui.
 */
export function OnlineOrdersAdmin() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [tab, setTab] = useState<OnlineOrderStatus>('PENDING');

  const [rejecting, setRejecting] = useState<OrderRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelling, setCancelling] = useState<OrderRow | null>(null);
  const [completing, setCompleting] = useState<OrderRow | null>(null);
  const [completePaymentMethod, setCompletePaymentMethod] = useState<'CASH' | 'CARD_IN_STORE'>('CASH');
  const [changingTime, setChangingTime] = useState<OrderRow | null>(null);
  const [timeForm, setTimeForm] = useState({ date: '', time: '' });

  const queueQuery = useQuery({
    queryKey: ['online-orders-queue'],
    queryFn: async () => (await api.get<OrderRow[]>('/online-orders')).data,
  });

  const ordersByTab = useMemo(() => {
    const grouped: Record<OnlineOrderStatus, OrderRow[]> = { PENDING: [], CONFIRMED: [], READY: [], COMPLETED: [], REJECTED: [], CANCELLED: [] };
    for (const order of queueQuery.data ?? []) grouped[order.status]?.push(order);
    return grouped;
  }, [queueQuery.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['online-orders-queue'] });

  const acceptMutation = useMutation({
    mutationFn: async (id: string) => (await api.patch(`/online-orders/${id}/accept`)).data,
    onSuccess: () => { invalidate(); showToast('Ordine confermato'); },
    onError: (error) => { invalidate(); showToast(extractErrorMessage(error)); },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await api.patch(`/online-orders/${id}/reject`, { reason })).data,
    onSuccess: () => {
      invalidate();
      setRejecting(null);
      setRejectReason('');
      showToast('Ordine rifiutato');
    },
    onError: (error) => showToast(extractErrorMessage(error)),
  });

  const readyMutation = useMutation({
    mutationFn: async (id: string) => (await api.patch(`/online-orders/${id}/ready`)).data,
    onSuccess: () => { invalidate(); showToast('Ordine segnato come pronto'); },
    onError: (error) => { invalidate(); showToast(extractErrorMessage(error)); },
  });

  const completeMutation = useMutation({
    mutationFn: async ({ id, paymentMethod }: { id: string; paymentMethod?: 'CASH' | 'CARD_IN_STORE' }) =>
      (await api.patch(`/online-orders/${id}/complete`, paymentMethod ? { paymentMethod } : {})).data,
    onSuccess: () => {
      invalidate();
      setCompleting(null);
      showToast('Ordine completato');
    },
    onError: (error) => showToast(extractErrorMessage(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => (await api.patch(`/online-orders/${id}/cancel`)).data,
    onSuccess: () => { invalidate(); setCancelling(null); showToast('Ordine annullato'); },
  });

  const proposeTimeMutation = useMutation({
    mutationFn: async ({ id, requestedAt }: { id: string; requestedAt: string }) =>
      (await api.patch(`/online-orders/${id}/time`, { requestedAt })).data,
    onSuccess: () => {
      invalidate();
      setChangingTime(null);
      showToast('Nuovo orario proposto: in attesa di conferma del cliente');
    },
  });

  const renderOrderCard = (order: OrderRow) => (
    <Card key={order.id} variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" fontWeight={600}>
                {order.firstName} {order.lastName}
              </Typography>
              <Chip size="small" color={statusColors[order.status]} label={tabLabels[order.status]} />
              <Chip size="small" variant="outlined" label={order.fulfillment === 'PICKUP' ? 'Ritiro' : 'Consegna'} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {formatWhen(order.requestedAt)}
              {' — '}
              <a href={`tel:${order.phone}`} style={{ color: 'inherit' }}>
                {order.phone}
              </a>
            </Typography>
            {order.deliveryAddress && (
              <Typography variant="body2" color="text.secondary">
                {order.deliveryAddress}
              </Typography>
            )}
            {order.proposedRequestedAt && (
              <Chip
                size="small"
                color="warning"
                sx={{ mt: 0.5 }}
                label={`In attesa di conferma nuovo orario: ${formatWhen(order.proposedRequestedAt)}`}
              />
            )}
            <Box sx={{ mt: 1 }}>
              {order.lines.map((line) => (
                <Typography key={line.id} variant="body2">
                  {line.quantity}× {line.itemName}
                  {line.variantName ? ` (${line.variantName})` : ''}
                  {line.modifiers.length > 0 && ` — ${line.modifiers.map((m) => m.optionName).join(', ')}`}
                  {line.note && ` — nota: ${line.note}`}
                </Typography>
              ))}
            </Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 0.5 }}>
              Totale € {order.total.toFixed(2)}
            </Typography>
          </Box>

          <Stack spacing={1} alignItems="flex-end">
            <Stack direction="row" spacing={1}>
              <IconButton size="small" component="a" href={`tel:${order.phone}`} title="Chiama">
                <PhoneIcon fontSize="small" />
              </IconButton>
              {order.fulfillment === 'DELIVERY' && order.status === 'READY' && order.deliveryLat != null && order.deliveryLng != null && (
                <IconButton
                  size="small"
                  component="a"
                  href={navigateUrl(order.deliveryLat, order.deliveryLng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Naviga"
                >
                  <DirectionsIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>

            {(order.status === 'PENDING' || order.status === 'CONFIRMED' || order.status === 'READY') && (
              <Button
                size="small"
                onClick={() => {
                  setChangingTime(order);
                  setTimeForm(splitDateTime(order.proposedRequestedAt ?? order.requestedAt));
                }}
              >
                Proponi orario
              </Button>
            )}

            {order.status === 'PENDING' && (
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="contained" color="success" onClick={() => acceptMutation.mutate(order.id)}>
                  Accetta
                </Button>
                <Button size="small" variant="outlined" color="error" onClick={() => setRejecting(order)}>
                  Rifiuta
                </Button>
              </Stack>
            )}
            {order.status === 'CONFIRMED' && (
              <Button size="small" variant="contained" onClick={() => readyMutation.mutate(order.id)}>
                Segna come pronto
              </Button>
            )}
            {order.status === 'READY' && (
              <Button
                size="small"
                variant="contained"
                color="success"
                onClick={() => {
                  if (order.fulfillment === 'DELIVERY') {
                    completeMutation.mutate({ id: order.id });
                  } else {
                    setCompleting(order);
                    setCompletePaymentMethod('CASH');
                  }
                }}
              >
                Completa
              </Button>
            )}
            {(order.status === 'PENDING' || order.status === 'CONFIRMED' || order.status === 'READY') && (
              <Button size="small" color="error" onClick={() => setCancelling(order)}>
                Annulla ordine
              </Button>
            )}
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Typography variant="h6">Ordini online</Typography>

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 0 }} variant="scrollable" scrollButtons="auto">
        {QUEUE_TABS.map((s) => (
          <Tab key={s} value={s} label={`${tabLabels[s]} (${ordersByTab[s].length})`} sx={{ minHeight: 0 }} />
        ))}
      </Tabs>

      <Stack spacing={2}>
        {ordersByTab[tab].map(renderOrderCard)}
        {ordersByTab[tab].length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessun ordine in questo stato.
          </Typography>
        )}
      </Stack>

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Rifiuta ordine</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
          <Typography variant="body2" color="text.secondary">
            Il motivo verrà comunicato via email a {rejecting?.firstName} {rejecting?.lastName}.
          </Typography>
          <TextField
            label="Motivo del rifiuto"
            multiline
            minRows={2}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          {rejectMutation.isError && <Alert severity="error">{extractErrorMessage(rejectMutation.error)}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setRejecting(null)}>Annulla</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!rejectReason.trim() || rejectMutation.isPending}
            onClick={() => rejecting && rejectMutation.mutate({ id: rejecting.id, reason: rejectReason.trim() })}
          >
            Rifiuta
          </Button>
        </DialogActions>
      </Dialog>

      {/* Solo per il ritiro: il pagamento non è mai scelto online dal cliente, lo registra a mano l'operatore qui (§5.10). */}
      <Dialog open={!!completing} onClose={() => setCompleting(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Completa ordine</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
          <Typography variant="body2" color="text.secondary">
            Indica come {completing?.firstName} {completing?.lastName} ha pagato in negozio.
          </Typography>
          <RadioGroup
            value={completePaymentMethod}
            onChange={(e) => setCompletePaymentMethod(e.target.value as 'CASH' | 'CARD_IN_STORE')}
          >
            <FormControlLabel value="CASH" control={<Radio />} label="Contanti" />
            <FormControlLabel value="CARD_IN_STORE" control={<Radio />} label="Carta in negozio" />
          </RadioGroup>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setCompleting(null)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={completeMutation.isPending}
            onClick={() =>
              completing && completeMutation.mutate({ id: completing.id, paymentMethod: completePaymentMethod })
            }
          >
            Completa
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!cancelling}
        title="Annullare l'ordine?"
        message={cancelling ? `L'ordine di ${cancelling.firstName} ${cancelling.lastName} verrà annullato.` : ''}
        confirmLabel="Annulla ordine"
        loading={cancelMutation.isPending}
        onCancel={() => setCancelling(null)}
        onConfirm={() => cancelling && cancelMutation.mutate(cancelling.id)}
      />

      {/* Proposta di nuovo orario (§5.10): non cambia subito l'ordine, chiede prima conferma al cliente via email/pagina di tracciamento — nessun vincolo di orario/fascia, è un'azione dello staff. */}
      <Dialog open={!!changingTime} onClose={() => setChangingTime(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Proponi nuovo orario</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
          <Typography variant="body2" color="text.secondary">
            Il nuovo orario verrà proposto a {changingTime?.firstName} {changingTime?.lastName}, che dovrà
            confermarlo dalla pagina di tracciamento prima che diventi effettivo.
          </Typography>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Data"
              type="date"
              InputLabelProps={{ shrink: true }}
              fullWidth
              value={timeForm.date}
              onChange={(e) => setTimeForm((f) => ({ ...f, date: e.target.value }))}
            />
            <QuarterHourTimeField
              label="Orario"
              fullWidth
              value={timeForm.time}
              onChange={(time) => setTimeForm((f) => ({ ...f, time }))}
            />
          </Stack>
          {proposeTimeMutation.isError && (
            <Alert severity="error">{extractErrorMessage(proposeTimeMutation.error)}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setChangingTime(null)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!timeForm.date || !timeForm.time || proposeTimeMutation.isPending}
            onClick={() =>
              changingTime &&
              proposeTimeMutation.mutate({
                id: changingTime.id,
                requestedAt: new Date(`${timeForm.date}T${timeForm.time}:00`).toISOString(),
              })
            }
          >
            Proponi
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
