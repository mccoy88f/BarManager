import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import CloseIcon from '@mui/icons-material/Close';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { canAccessModule } from '../config/modules';

const STORAGE_KEY = 'barmanager_sound_notifications_enabled';
const POLL_INTERVAL_MS = 12000;

interface OrderRowSummary {
  id: string;
  status: string;
  awaitingShopOpening: boolean;
  requestedAt: string;
  firstName: string;
  lastName: string;
}

function isAwaitingOpening(order: { awaitingShopOpening: boolean; requestedAt: string }): boolean {
  return order.awaitingShopOpening && new Date(order.requestedAt).getTime() > Date.now();
}

/**
 * Allarme sonoro sintetizzato con Web Audio API:
 * Suono squillante a doppio tono per non passare inosservato anche con rumore di fondo.
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
    gain1.gain.setValueAtTime(0.25, now);
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
    gain2.gain.setValueAtTime(0.3, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.45);
  } catch {
    // Audio momentaneamente non disponibile
  }
}

interface OrderNotificationContextValue {
  soundEnabled: boolean;
  toggleSound: () => void;
  enableSound: () => void;
  disableSound: () => void;
  hasActivePendingOrders: boolean;
  activePendingCount: number;
  markOrderHandled: (orderId: string) => void;
}

const OrderNotificationContext = createContext<OrderNotificationContextValue | null>(null);

export function OrderNotificationProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const location = useLocation();

  const hasOnlineOrdersAccess = Boolean(
    user && user.role !== 'SUPER_ADMIN' && canAccessModule(user, 'onlineOrders'),
  );

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });
  const [promptOpen, setPromptOpen] = useState(false);
  const [dismissedToast, setDismissedToast] = useState(false);
  const [handledPendingIds, setHandledPendingIds] = useState<Set<string>>(new Set());

  const audioCtxRef = useRef<AudioContext | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // Mostra il prompt di autorizzazione all'avvio se la preferenza non è ancora mai stata salvata
  useEffect(() => {
    if (!hasOnlineOrdersAccess) return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      setPromptOpen(true);
    }
  }, [hasOnlineOrdersAccess]);

  // Sblocca silenziosamente l'audio al primo tocco/clic se l'utente aveva già abilitato il suono in passato
  useEffect(() => {
    if (!soundEnabled) return;
    const unlock = () => {
      getAudioContext();
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, [soundEnabled, getAudioContext]);

  const enableSound = useCallback(() => {
    const ctx = getAudioContext();
    localStorage.setItem(STORAGE_KEY, 'true');
    setSoundEnabled(true);
    playOrderAlertBeep(ctx);
  }, [getAudioContext]);

  const disableSound = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'false');
    setSoundEnabled(false);
  }, []);

  const toggleSound = useCallback(() => {
    if (soundEnabled) {
      disableSound();
    } else {
      enableSound();
    }
  }, [soundEnabled, disableSound, enableSound]);

  // Query in background su tutta l'applicazione per intercettare gli ordini in coda
  const queueQuery = useQuery({
    queryKey: ['online-orders-queue'],
    queryFn: async () => (await api.get<OrderRowSummary[]>('/online-orders')).data,
    enabled: hasOnlineOrdersAccess,
    refetchInterval: POLL_INTERVAL_MS,
  });

  // Ordini attivi in stato PENDING che richiedono l'intervento dello staff
  const activePendingOrders = useMemo(() => {
    return (queueQuery.data ?? []).filter(
      (o) => o.status === 'PENDING' && !isAwaitingOpening(o) && !handledPendingIds.has(o.id),
    );
  }, [queueQuery.data, handledPendingIds]);

  const activePendingCount = activePendingOrders.length;
  const hasActivePendingOrders = activePendingCount > 0;

  // Ripulisci gli id gestiti localmente quando il server non li riporta più tra i PENDING
  useEffect(() => {
    if (!queueQuery.data) return;
    const serverPendingIds = new Set(
      queueQuery.data.filter((o) => o.status === 'PENDING').map((o) => o.id),
    );
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

  // Se compare un nuovo ordine dopo che il toast era stato chiuso a mano, riaprilo
  const previousCountRef = useRef(activePendingCount);
  useEffect(() => {
    if (activePendingCount > previousCountRef.current) {
      setDismissedToast(false);
    }
    previousCountRef.current = activePendingCount;
  }, [activePendingCount]);

  // Riproduzione continua del suono finché ci sono ordini PENDING attivi
  useEffect(() => {
    if (!soundEnabled || !hasActivePendingOrders) return;

    const ctx = getAudioContext();
    playOrderAlertBeep(ctx);

    const interval = setInterval(() => {
      playOrderAlertBeep(ctx);
    }, 3500);

    return () => clearInterval(interval);
  }, [soundEnabled, hasActivePendingOrders, getAudioContext]);

  const markOrderHandled = useCallback((orderId: string) => {
    setHandledPendingIds((prev) => new Set(prev).add(orderId));
  }, []);

  const handleDismissPrompt = () => {
    setPromptOpen(false);
    localStorage.setItem(STORAGE_KEY, 'false');
    setSoundEnabled(false);
  };

  const handleAcceptPrompt = () => {
    setPromptOpen(false);
    enableSound();
  };

  return (
    <OrderNotificationContext.Provider
      value={{
        soundEnabled,
        toggleSound,
        enableSound,
        disableSound,
        hasActivePendingOrders,
        activePendingCount,
        markOrderHandled,
      }}
    >
      {children}

      {/* Dialog di richiesta autorizzazione audio al primo avvio */}
      <Dialog open={promptOpen} onClose={handleDismissPrompt} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <NotificationsActiveIcon color="primary" />
          Notifiche sonore ordini
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Vuoi abilitare le notifiche sonore per gli ordini online? Riceverai un avviso sonoro continuo
            in qualsiasi schermata del gestionale o della PWA all&apos;arrivo di nuovi ordini da confermare.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleDismissPrompt} color="inherit">
            Non ora
          </Button>
          <Button onClick={handleAcceptPrompt} variant="contained" autoFocus>
            Attiva audio
          </Button>
        </DialogActions>
      </Dialog>

      {/* Toast/Snackbar persistente e interattivo per nuovi ordini online */}
      <Snackbar
        open={hasActivePendingOrders && !dismissedToast}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ mt: { xs: 7, sm: 8 } }}
      >
        <Alert
          severity="warning"
          variant="filled"
          icon={<NotificationsActiveIcon />}
          sx={{
            width: '100%',
            alignItems: 'center',
            boxShadow: 6,
            fontWeight: 500,
          }}
          action={
            <Stack direction="row" spacing={1} alignItems="center">
              {location.pathname !== '/online-orders' && (
                <Button
                  color="inherit"
                  size="small"
                  variant="outlined"
                  sx={{
                    bgcolor: 'rgba(255,255,255,0.15)',
                    borderColor: 'rgba(255,255,255,0.8)',
                    color: '#fff',
                    fontWeight: 600,
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.25)' },
                  }}
                  onClick={() => {
                    navigate('/online-orders');
                  }}
                >
                  Visualizza ordine
                </Button>
              )}
              {soundEnabled && (
                <IconButton
                  size="small"
                  color="inherit"
                  title="Silenzia audio"
                  onClick={disableSound}
                >
                  <NotificationsOffIcon fontSize="small" />
                </IconButton>
              )}
              <IconButton
                size="small"
                color="inherit"
                title="Chiudi avviso"
                onClick={() => setDismissedToast(true)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          }
        >
          <Box>
            <Typography variant="subtitle2" fontWeight={700}>
              {activePendingCount === 1
                ? 'Nuovo ordine online da confermare!'
                : `${activePendingCount} nuovi ordini online da confermare!`}
            </Typography>
            {activePendingOrders[0] && (
              <Typography variant="caption" sx={{ opacity: 0.9 }}>
                {activePendingOrders[0].firstName} {activePendingOrders[0].lastName}
              </Typography>
            )}
          </Box>
        </Alert>
      </Snackbar>
    </OrderNotificationContext.Provider>
  );
}

export function useOrderNotification(): OrderNotificationContextValue {
  const ctx = useContext(OrderNotificationContext);
  if (!ctx) {
    throw new Error('useOrderNotification deve essere usato dentro OrderNotificationProvider');
  }
  return ctx;
}
