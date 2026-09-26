import { useEffect, useMemo, useRef, useState } from 'react';
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
 * Beep sintetizzato via Web Audio API per la notifica sonora di un nuovo
 * ordine (§5.10): niente file audio da distribuire, un semplice oscillatore
 * breve basta. Richiede un `AudioContext` già creato/ripreso da
 * un'interazione dell'utente (v. `enableSound` sotto) — i browser bloccano
 * altrimenti l'audio non ancora "sbloccato" da un gesto.
 */
function playOrderAlertBeep(ctx: AudioContext) {
  try {
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const now = ctx.currentTime;
    // Primo squillo: 880 Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.22);

    // Secondo squillo armonico: 1174.66 Hz (D6) dopo 120ms
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1174.66, now + 0.12);
    gain2.gain.setValueAtTime(0.25, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.4);
  } catch {
    // Context audio chiuso o non disponibile
  }
}

/**
 * Coda ordini online (§5.10 di DEVELOPMENT.md): tre schede — Da
 * confermare, In preparazione, Pronti — stesso schema a tab della coda
 * prenotazioni.
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

  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [handledPendingIds, setHandledPendingIds] = useState<Set<string>>(new Set());

  const toggleSound = () => {
    if (soundEnabled) {
      setSoundEnabled(false);
    } else {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        void audioCtxRef.current.resume();
      }
      setSoundEnabled(true);
      playOrderAlertBeep(audioCtxRef.current);
    }
  };

  const queueQuery = useQuery({
    queryKey: ['online-orders-queue'],
    queryFn: async () => (await api.get<OrderRow[]>('/online-orders')).data,
    refetchInterval: QUEUE_POLL_MS,
  });

  // Ordini in stato PENDING che richiedono l'intervento dello staff (non ancora accettati/rifiutati e negozio già aperto)
  const hasActivePendingOrders = useMemo(() => {
    return (queueQuery.data ?? []).some(
      (o) => o.status === 'PENDING' && !isAwaitingOpening(o) && !handledPendingIds.has(o.id),
    );
  }, [queueQuery.data, handledPendingIds]);

  // Se i dati del server si aggiornano, ripulisci gli handledPendingIds che non sono più PENDING
  useEffect(() => {
    if (!queueQuery.data) return;
    const serverPendingIds = new Set(queueQuery.data.filter((o) => o.status === 'PENDING').map((o) => o.id));
    setHandledPendingIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (serverPendingIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [queueQuery.data]);

  // Riproduzione continua finché ci sono ordini PENDING attivi o finché lo staff non disattiva il suono
  useEffect(() => {
    if (!soundEnabled || !hasActivePendingOrders) return;

    if (audioCtxRef.current) {
      playOrderAlertBeep(audioCtxRef.current);
    }

    const interval = setInterval(() => {
      if (audioCtxRef.current) {
        playOrderAlertBeep(audioCtxRef.current);
      }
    }, 3500);

    return () => clearInterval(interval);
  }, [soundEnabled, hasActivePendingOrders]);

  const ordersByTab = useMemo(() => {
    const grouped: Record<OnlineOrderStatus, OrderRow[]> = { PENDING: [], CONFIRMED: [], READY: [], COMPLETED: [], REJECTED: [], CANCELLED: [] };
    for (const order of queueQuery.data ?? []) grouped[order.status]?.push(order);
    return grouped;
  }, [queueQuery.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['online-orders-queue'] });

  const acceptMutation = useMutation({
    mutationFn: async (id: string) => {
      setHandledPendingIds((prev) => new Set(prev).add(id));
      return (await api.patch(`/online-orders/${id}/accept`)).data;
    },
    onSuccess: () => { invalidate(); showToast('Ordine confermato'); },
    onError: (error, id) => {
      setHandledPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      invalidate();
      showToast(extractErrorMessage(error));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      setHandledPendingIds((prev) => new Set(prev).add(id));
      return (await api.patch(`/online-orders/${id}/reject`, { reason })).data;
    },
    onSuccess: () => {
      invalidate();
      setRejecting(null);
      setRejectReason('');
      showToast('Ordine rifiutato');
    },
    onError: (error, { id }) => {
      setHandledPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showToast(extractErrorMessage(error));
    },
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
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {formatWhen(order.requestedAt)}
              {' — '}
              <a href={`tel:${order.phone}`} style={{ color: 'inherit' }}>
                {order.phone}
              </a>
            </Typography>
            {order.fulfillment === 'DELIVERY' && (
              <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  📍 {order.deliveryAddress || 'Consegna a domicilio'}
                </Typography>
                {navigateUrl(order.deliveryLat, order.deliveryLng, order.deliveryAddress) && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    startIcon={<DirectionsIcon fontSize="small" />}
                    component="a"
                    href={navigateUrl(order.deliveryLat, order.deliveryLng, order.deliveryAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ textTransform: 'none', py: 0.2, px: 1, fontSize: '0.8125rem' }}
                  >
                    Raggiungi il luogo
                  </Button>
                )}
              </Box>
            )}
            {order.proposedRequestedAt && (
              <Chip
                size="small"
                color="warning"
                sx={{ mt: 0.5 }}
                label={`In attesa di conferma nuovo orario: ${formatWhen(order.proposedRequestedAt)}`}
              />
            )}
            {isAwaitingOpening(order) && (
              <Chip
                size="small"
                color="warning"
                sx={{ mt: 0.5, ml: order.proposedRequestedAt ? 0.5 : 0 }}
                label={`In attesa di apertura (${formatWhen(order.requestedAt)})`}
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
              {order.fulfillment === 'DELIVERY' && navigateUrl(order.deliveryLat, order.deliveryLng, order.deliveryAddress) && (
                <IconButton
                  size="small"
                  color="primary"
                  component="a"
                  href={navigateUrl(order.deliveryLat, order.deliveryLng, order.deliveryAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Raggiungi il luogo (Google Maps)"
                >
                  <DirectionsIcon fontSize="small" />
                </IconButton>
              )}
              <IconButton
                size="small"
                title="Stampa comanda cucina"
                onClick={() => printMutation.mutate({ id: order.id, kind: 'kitchen-ticket' })}
              >
                <SoupKitchenIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                title="Stampa scontrino completo"
                onClick={() => printMutation.mutate({ id: order.id, kind: 'receipt' })}
              >
                <ReceiptLongIcon fontSize="small" />
              </IconButton>
            </Stack>

            {(order.status === 'PENDING' || order.status === 'CONFIRMED' || order.status === 'READY') && (
              <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="flex-end" alignItems="center">
                {order.status === 'PENDING' && (
                  <Button size="small" variant="contained" color="success" onClick={() => acceptMutation.mutate(order.id)}>
                    Accetta
                  </Button>
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
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setChangingTime(order);
                    setTimeForm(splitDateTime(order.proposedRequestedAt ?? order.requestedAt));
                  }}
                >
                  Proponi orario
                </Button>
                {order.status === 'PENDING' && (
                  <Button size="small" variant="outlined" color="error" onClick={() => setRejecting(order)}>
                    Rifiuta
                  </Button>
                )}
                <Button size="small" color="error" onClick={() => setCancelling(order)}>
                  Annulla ordine
                </Button>
              </Stack>
            )}
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">Ordini online</Typography>
        <Button
          size="small"
          variant={soundEnabled ? 'contained' : 'outlined'}
          color={soundEnabled ? 'primary' : 'inherit'}
          startIcon={soundEnabled ? <NotificationsActiveIcon /> : <NotificationsOffIcon />}
          onClick={toggleSound}
        >
          {soundEnabled ? 'Notifiche sonore attive (clicca per disattivare)' : 'Attiva notifiche sonore'}
        </Button>
      </Box>

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
