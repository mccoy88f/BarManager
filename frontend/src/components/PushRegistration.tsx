import { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { isNativeApp, nativePush } from '../printing/nativePrint';
import { requestNotificationPermission, subscribeWebPush } from '../utils/devicePermissions';

const LATER_KEY = 'bm_push_later';

/**
 * All'avvio chiede le notifiche a chi è entrato nel gestionale e registra il
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
          await requestNotificationPermission();
          const { plugin } = await nativePush();
          const { path } = await plugin.consumePath();
          if (!cancelled && path && path.startsWith('/') && path !== window.location.pathname) {
            navigate(path);
          }
        } catch {
          if (!cancelled) setAsk(true);
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
      if (Notification.permission === 'default' && sessionStorage.getItem(LATER_KEY) !== '1' && !cancelled) {
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
    try {
      await requestNotificationPermission();
    } catch {
      // Il gestionale resta usabile anche senza notifiche.
    }
  };

  return (
    <Dialog open={ask} onClose={() => setAsk(false)}>
      <DialogTitle>Notifiche su questo dispositivo</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Servono per gli aggiornamenti dell'app, le prenotazioni e gli ordini. Le richieste di ferie e permessi arrivano solo a chi gestisce le timbrature.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            sessionStorage.setItem(LATER_KEY, '1');
            setAsk(false);
          }}
        >
          Non ora
        </Button>
        <Button variant="contained" onClick={() => void activate()}>
          Attiva
        </Button>
      </DialogActions>
    </Dialog>
  );
}
