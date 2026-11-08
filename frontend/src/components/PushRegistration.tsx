import { useEffect, useState } from 'react';
import { Alert, Button, Snackbar } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { isNativeApp, nativePush } from '../printing/nativePrint';

const DISMISS_KEY = 'bm_push_dismissed';
const ANDROID_TOKEN_KEY = 'bm_push_android_token';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function subscribeWebPush() {
  const registration = await navigator.serviceWorker.ready;
  const { data } = await api.get<{ publicKey: string }>('/push/vapid-public-key');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey) as BufferSource,
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
  await api.post('/push/web', { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
}

async function enableAndroid() {
  const stored = localStorage.getItem(ANDROID_TOKEN_KEY) || undefined;
  const { data } = await api.post<{ token: string }>('/push/android', { token: stored });
  localStorage.setItem(ANDROID_TOKEN_KEY, data.token);
  const { plugin } = await nativePush();
  await plugin.start({ apiBase: window.location.origin, token: data.token });
}

/**
 * Chiede il permesso notifiche a chi è entrato nel gestionale e registra il
 * dispositivo. Sulla PWA è Web Push; sull'APK è la coda nativa, perché la
 * WebView non riceve le push del browser.
 */
export function PushRegistration() {
  const userId = useAuthStore((s) => s.user?.userId);
  const navigate = useNavigate();
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const run = async () => {
      if (isNativeApp()) {
        try {
          await enableAndroid();
          const { plugin } = await nativePush();
          const { path } = await plugin.consumePath();
          if (!cancelled && path && path.startsWith('/') && path !== window.location.pathname) {
            navigate(path);
          }
        } catch {
          // Il permesso può essere negato: il gestionale resta usabile.
        }
        return;
      }

      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
      if (Notification.permission === 'granted') {
        try {
          await subscribeWebPush();
        } catch {
          // Riproverà al prossimo accesso.
        }
        return;
      }
      if (Notification.permission === 'default' && localStorage.getItem(DISMISS_KEY) !== '1' && !cancelled) {
        setAsk(true);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [userId, navigate]);

  const activate = async () => {
    setAsk(false);
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      localStorage.setItem(DISMISS_KEY, '1');
      return;
    }
    try {
      await subscribeWebPush();
    } catch {
      localStorage.setItem(DISMISS_KEY, '1');
    }
  };

  return (
    <Snackbar open={ask} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert
        severity="info"
        action={
          <>
            <Button color="inherit" size="small" onClick={() => void activate()}>
              Attiva
            </Button>
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                localStorage.setItem(DISMISS_KEY, '1');
                setAsk(false);
              }}
            >
              Non ora
            </Button>
          </>
        }
      >
        Attiva le notifiche su questo dispositivo: aggiornamenti, prenotazioni e ordini. Le richieste di permesso arrivano solo a chi gestisce le timbrature.
      </Alert>
    </Snackbar>
  );
}
