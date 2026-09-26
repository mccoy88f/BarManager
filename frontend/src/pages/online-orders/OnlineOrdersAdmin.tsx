import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
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
  Tooltip,
  Typography,
} from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import DirectionsIcon from '@mui/icons-material/Directions';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import SoupKitchenIcon from '@mui/icons-material/SoupKitchen';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { QuarterHourTimeField } from '../../components/QuarterHourTimeField';
import { useToast } from '../../components/ToastProvider';
import { PENDING_CHIP_COLOR, SUCCESS_CHIP_COLOR, NEUTRAL_CHIP_COLOR } from '../../config/statusChip';
import { shareReceiptPdf } from '../../printing/printJob';
import { useOrderNotification } from '../../context/OrderNotificationContext';

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
  paymentMethod: 'CASH' | 'CARD_ONLINE' | 'CARD_IN_STORE' | null;
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  requestedAt: string;
  awaitingShopOpening: boolean;
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

/** Tab visibili nel pannello (REJECTED e CANCELLED accorpati in CLOSED). */
const QUEUE_TABS: (OnlineOrderStatus | 'CLOSED')[] = ['PENDING', 'CONFIRMED', 'READY', 'COMPLETED', 'CLOSED'];

const tabLabels: Record<OnlineOrderStatus | 'CLOSED', string> = {
  PENDING: 'Da confermare',
  CONFIRMED: 'In preparazione',
  READY: 'Pronti',
  COMPLETED: 'Completati',
  REJECTED: 'Rifiutati',
  CANCELLED: 'Annullati',
  CLOSED: 'Rifiutati / Annullati',
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

function navigateUrl(lat?: number | null, lng?: number | null, address?: string | null): string {
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  if (address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  }
  return '';
}

/** Ordine "il prima possibile" arrivato mentre il negozio era chiuso (§5.10), la cui apertura non è ancora passata. */
function isAwaitingOpening(order: OrderRow): boolean {
  return order.awaitingShopOpening && new Date(order.requestedAt).getTime() > Date.now();
}

/** Fascia di poll della coda (§5.10 di DEVELOPMENT.md: "coda in tempo reale", non un vero WebSocket in questa v1). */
const QUEUE_POLL_MS = 15000;

/**
 * Coda ordini online (§5.10 di DEVELOPMENT.md): tre schede — Da
 * confermare, In preparazione, Pronti — stesso schema a tab della coda
 * prenotazioni.
 */
export function OnlineOrdersAdmin() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [tab, setTab] = useState<OnlineOrderStatus | 'CLOSED'>('PENDING');

  const [rejecting, setRejecting] = useState<OrderRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelling, setCancelling] = useState<OrderRow | null>(null);
  const [completing, setCompleting] = useState<OrderRow | null>(null);
  const [completePaymentMethod, setCompletePaymentMethod] = useState<'CASH' | 'CARD_IN_STORE'>('CASH');
  const [changingTime, setChangingTime] = useState<OrderRow | null>(null);
  const [timeForm, setTimeForm] = useState({ date: '', time: '' });

  const { soundEnabled, toggleSound, markOrderHandled } = useOrderNotification();

  const queueQuery = useQuery({
    queryKey: ['online-orders-queue'],
    queryFn: async () => (await api.get<OrderRow[]>('/online-orders')).data,
    refetchInterval: QUEUE_POLL_MS,
  });

  const ordersByTab = useMemo(() => {
    const grouped: Record<OnlineOrderStatus | 'CLOSED', OrderRow[]> = { PENDING: [], CONFIRMED: [], READY: [], COMPLETED: [], REJECTED: [], CANCELLED: [], CLOSED: [] };
    for (const order of queueQuery.data ?? []) {
      grouped[order.status]?.push(order);
      if (order.status === 'REJECTED' || order.status === 'CANCELLED') {
        grouped.CLOSED.push(order);
      }
    }
    return grouped;
  }, [queueQuery.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['online-orders-queue'] });

  const acceptMutation = useMutation({
    mutationFn: async (id: string) => {
      markOrderHandled(id);
      return (await api.patch(`/online-orders/${id}/accept`)).data;
    },
    onSuccess: () => { invalidate(); showToast('Ordine confermato'); },
    onError: (error) => { invalidate(); showToast(extractErrorMessage(error)); },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      markOrderHandled(id);
      return (await api.patch(`/online-orders/${id}/reject`, { reason })).data;
    },
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

  /** Due scontrini distinti (§5.10): comanda cucina senza prezzi/indirizzo, scontrino completo per staff/rider — stesso schema di condivisione PDF già usato per gli ordini fornitori (§5.3). */
  const printMutation = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: 'kitchen-ticket' | 'receipt' }) => {
      const response = await api.get(`/online-orders/${id}/${kind}/pdf`, { responseType: 'blob' });
      await shareReceiptPdf(response.data, kind === 'kitchen-ticket' ? `Comanda ${id}` : `Scontrino ${id}`);
    },
    onError: () => showToast({ message: 'Stampa non riuscita.', severity: 'error' }),
  });

  const renderOrderCard = (order: OrderRow) => (
    <Card
      key={order.id}
      variant="outlined"
      sx={{
        borderRadius: 2.5,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        borderColor: order.status === 'PENDING' ? 'warning.main' : 'divider',
        borderWidth: order.status === 'PENDING' ? 2 : 1,
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        '&:hover': {
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        },
      }}
    >
      <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
        {/* Intestazione card: Dati cliente e chip a sinistra, pulsanti di stampa in alto a destra */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ gap: 0.75 }}>
              <Typography variant="h6" fontWeight={700} sx={{ fontSize: { xs: '1.05rem', sm: '1.15rem' } }}>
                {order.firstName} {order.lastName}
              </Typography>
              <Chip size="small" color={statusColors[order.status]} label={tabLabels[order.status]} sx={{ fontWeight: 600 }} />
              <Chip size="small" variant="outlined" label={order.fulfillment === 'PICKUP' ? 'Ritiro' : 'Consegna'} sx={{ fontWeight: 500 }} />
              <Chip
                size="small"
                variant="outlined"
                label={
                  order.paymentMethod === 'CARD_ONLINE'
                    ? 'Carta online'
                    : order.paymentMethod === 'CASH'
                      ? (order.fulfillment === 'DELIVERY' ? 'Contanti alla consegna' : 'Contanti')
                      : order.paymentMethod === 'CARD_IN_STORE'
                        ? 'Carta in negozio'
                        : order.fulfillment === 'PICKUP'
                          ? 'Al ritiro'
                          : 'Non indicato'
                }
                sx={{ fontWeight: 500 }}
              />
            </Stack>

            {/* Riga 1: ora + telefono affiancato */}
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" sx={{ mt: 1, gap: 1 }}>
              <Typography variant="body2" color="text.secondary" fontWeight={500}>
                🕒 {formatWhen(order.requestedAt)}
              </Typography>
              <Button
                component="a"
                href={`tel:${order.phone}`}
                size="small"
                variant="outlined"
                color="primary"
                startIcon={<PhoneIcon sx={{ fontSize: 18 }} />}
                sx={{
                  minHeight: 38,
                  px: 1.75,
                  py: 0.5,
                  fontWeight: 600,
                  textTransform: 'none',
                  borderRadius: 2,
                }}
                title="Chiama cliente"
              >
                {order.phone}
              </Button>
            </Stack>

            {/* Riga 2 (solo DELIVERY): indirizzo + navigazione affiancato */}
            {order.fulfillment === 'DELIVERY' && (
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" sx={{ mt: 0.75, gap: 1 }}>
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                  📍 {order.deliveryAddress || 'Consegna a domicilio'}
                </Typography>
                {navigateUrl(order.deliveryLat, order.deliveryLng, order.deliveryAddress) && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    startIcon={<DirectionsIcon sx={{ fontSize: 18 }} />}
                    component="a"
                    href={navigateUrl(order.deliveryLat, order.deliveryLng, order.deliveryAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      minHeight: 38,
                      px: 1.75,
                      py: 0.5,
                      fontWeight: 600,
                      textTransform: 'none',
                      borderRadius: 2,
                    }}
                  >
                    Raggiungi il luogo
                  </Button>
                )}
              </Stack>
            )}
          </Box>

          {/* In alto a destra: stampe comanda cucina e scontrino (touch target 44x44px) */}
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Tooltip title="Stampa comanda cucina">
              <IconButton
                onClick={() => printMutation.mutate({ id: order.id, kind: 'kitchen-ticket' })}
                sx={{
                  width: 44,
                  height: 44,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  bgcolor: 'background.paper',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
                aria-label="Stampa comanda cucina"
              >
                <SoupKitchenIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Stampa scontrino completo">
              <IconButton
                onClick={() => printMutation.mutate({ id: order.id, kind: 'receipt' })}
                sx={{
                  width: 44,
                  height: 44,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  bgcolor: 'background.paper',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
                aria-label="Stampa scontrino completo"
              >
                <ReceiptLongIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        {order.proposedRequestedAt && (
          <Box sx={{ mt: 1.5 }}>
            <Chip
              size="medium"
              color="warning"
              label={`In attesa di conferma nuovo orario: ${formatWhen(order.proposedRequestedAt)}`}
              sx={{ fontWeight: 600 }}
            />
          </Box>
        )}
        {isAwaitingOpening(order) && (
          <Box sx={{ mt: 1 }}>
            <Chip
              size="medium"
              color="warning"
              label={`In attesa di apertura (${formatWhen(order.requestedAt)})`}
              sx={{ fontWeight: 600 }}
            />
          </Box>
        )}

        {/* Box Prodotti ordinati */}
        <Box
          sx={{
            mt: 2,
            p: 1.75,
            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'grey.50'),
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          {order.lines.map((line) => (
            <Box key={line.id} sx={{ mb: 1, '&:last-child': { mb: 0 } }}>
              <Typography variant="body1" fontWeight={600}>
                {line.quantity}× {line.itemName}
                {line.variantName?.trim() ? ` (${line.variantName.trim()})` : ''}
              </Typography>
              {line.modifiers.map((m, idx) => (
                <Typography key={idx} variant="body2" color="text.secondary" sx={{ display: 'block', pl: 1.5, mt: 0.25, fontWeight: 500 }}>
                  + {m.optionName}{m.price > 0 ? ` (+€ ${m.price.toFixed(2)})` : ''}
                </Typography>
              ))}
              {line.note?.trim() && (
                <Typography variant="body2" color="text.secondary" sx={{ display: 'block', pl: 1.5, mt: 0.25, fontStyle: 'italic' }}>
                  nota: {line.note.trim()}
                </Typography>
              )}
            </Box>
          ))}
          <Box
            sx={{
              mt: 1.5,
              pt: 1.25,
              borderTop: '1px dashed',
              borderColor: 'divider',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {order.fulfillment === 'DELIVERY' && order.deliveryFee > 0 ? `Consegna: € ${order.deliveryFee.toFixed(2)}` : ''}
            </Typography>
            <Typography variant="subtitle1" fontWeight={700}>
              Totale € {order.total.toFixed(2)}
            </Typography>
          </Box>
        </Box>

        {/* Barra azioni sul fondo della card — bottoni ampi touch-friendly */}
        {(order.status === 'PENDING' || order.status === 'CONFIRMED' || order.status === 'READY') && (
          <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>

            {/* PENDING: Accetta (verde) | Proponi orario (arancione) | Rifiuta (rosso) */}
            {order.status === 'PENDING' && (
              <Stack direction="row" spacing={1.5} flexWrap="wrap" alignItems="center" sx={{ gap: 1.25 }}>
                <ButtonGroup variant="contained" disableElevation sx={{ borderRadius: 2, overflow: 'hidden' }}>
                  <Button
                    color="success"
                    onClick={() => acceptMutation.mutate(order.id)}
                    sx={{ minHeight: 44, px: 3, fontWeight: 700, fontSize: '0.95rem' }}
                  >
                    Accetta
                  </Button>
                  <Button
                    sx={{
                      minHeight: 44,
                      px: 2.5,
                      fontWeight: 600,
                      fontSize: '0.9rem',
                      bgcolor: 'warning.main',
                      color: 'warning.contrastText',
                      '&:hover': { bgcolor: 'warning.dark' },
                    }}
                    onClick={() => {
                      setChangingTime(order);
                      setTimeForm(splitDateTime(order.proposedRequestedAt ?? order.requestedAt));
                    }}
                  >
                    Proponi orario
                  </Button>
                  <Button
                    color="error"
                    onClick={() => setRejecting(order)}
                    sx={{ minHeight: 44, px: 2.5, fontWeight: 600, fontSize: '0.9rem' }}
                  >
                    Rifiuta
                  </Button>
                </ButtonGroup>
                <Button
                  size="medium"
                  color="error"
                  variant="text"
                  onClick={() => setCancelling(order)}
                  sx={{ minHeight: 44, px: 2, fontWeight: 600, borderRadius: 2, textTransform: 'none' }}
                >
                  Annulla ordine
                </Button>
              </Stack>
            )}

            {/* CONFIRMED: Segna come pronto (verde) | Proponi orario (arancione) | Annulla ordine (rosso) */}
            {order.status === 'CONFIRMED' && (
              <ButtonGroup variant="contained" disableElevation sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Button
                  color="success"
                  onClick={() => readyMutation.mutate(order.id)}
                  sx={{ minHeight: 44, px: 3, fontWeight: 700, fontSize: '0.95rem' }}
                >
                  Segna come pronto
                </Button>
                <Button
                  sx={{
                    minHeight: 44,
                    px: 2.5,
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    bgcolor: 'warning.main',
                    color: 'warning.contrastText',
                    '&:hover': { bgcolor: 'warning.dark' },
                  }}
                  onClick={() => {
                    setChangingTime(order);
                    setTimeForm(splitDateTime(order.proposedRequestedAt ?? order.requestedAt));
                  }}
                >
                  Proponi orario
                </Button>
                <Button
                  color="error"
                  onClick={() => setCancelling(order)}
                  sx={{ minHeight: 44, px: 2.5, fontWeight: 600, fontSize: '0.9rem' }}
                >
                  Annulla ordine
                </Button>
              </ButtonGroup>
            )}

            {/* READY: Completa (verde) | Annulla ordine (rosso) — proponi orario non necessario */}
            {order.status === 'READY' && (
              <ButtonGroup variant="contained" disableElevation sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Button
                  color="success"
                  onClick={() => {
                    if (order.fulfillment === 'DELIVERY') {
                      completeMutation.mutate({ id: order.id });
                    } else {
                      setCompleting(order);
                      setCompletePaymentMethod('CASH');
                    }
                  }}
                  sx={{ minHeight: 44, px: 3, fontWeight: 700, fontSize: '0.95rem' }}
                >
                  Completa
                </Button>
                <Button
                  color="error"
                  onClick={() => setCancelling(order)}
                  sx={{ minHeight: 44, px: 2.5, fontWeight: 600, fontSize: '0.9rem' }}
                >
                  Annulla ordine
                </Button>
              </ButtonGroup>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h5" fontWeight={700}>
            Ordini online
          </Typography>
          {ordersByTab.PENDING.length > 0 && (
            <Chip
              label={`${ordersByTab.PENDING.length} in attesa`}
              color="error"
              size="medium"
              sx={{ fontWeight: 700 }}
            />
          )}
        </Box>
        <Button
          variant={soundEnabled ? 'contained' : 'outlined'}
          color={soundEnabled ? 'primary' : 'inherit'}
          startIcon={soundEnabled ? <NotificationsActiveIcon /> : <NotificationsOffIcon />}
          onClick={toggleSound}
          sx={{
            minHeight: 42,
            px: 2,
            py: 1,
            fontWeight: 600,
            borderRadius: 2,
            textTransform: 'none',
          }}
        >
          {soundEnabled ? 'Notifiche sonore attive' : 'Attiva notifiche sonore'}
        </Button>
      </Box>

      <Tabs
        value={tab}
        onChange={(_e, v) => setTab(v as OnlineOrderStatus | 'CLOSED')}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          minHeight: 48,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTab-root': {
            minHeight: 48,
            minWidth: { xs: 'auto', sm: 120 },
            px: { xs: 1.5, sm: 2.5 },
            py: 1.25,
            fontWeight: 600,
            fontSize: '0.9rem',
            textTransform: 'none',
          },
        }}
      >
        {QUEUE_TABS.map((s) => (
          <Tab
            key={s}
            value={s}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <span>{tabLabels[s]}</span>
                <Chip
                  size="small"
                  label={ordersByTab[s].length}
                  color={s === 'PENDING' && ordersByTab[s].length > 0 ? 'error' : tab === s ? 'primary' : 'default'}
                  sx={{
                    height: 22,
                    fontSize: '0.75rem',
                    fontWeight: 700,
                  }}
                />
              </Box>
            }
          />
        ))}
      </Tabs>

      <Stack spacing={2.5}>
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
