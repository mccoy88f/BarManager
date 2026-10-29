// Prima di tutto: TanStack Query crea un AbortController per ogni richiesta,
// assente sui WebView vecchi (Chrome < 66, es. i box Android 6 usati come
// display promo) e non coperto da core-js. Si installa solo se manca.
import 'abortcontroller-polyfill/dist/abortcontroller-polyfill-only';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DynamicThemeProvider } from './components/DynamicThemeProvider';
import { ToastProvider } from './components/ToastProvider';
import App from './App';
import { isNativeApp } from './printing/nativePrint';

// Senza notifyOnChangeProps, ogni useQuery avvolge il risultato in un Proxy
// (tracciamento dei campi letti): sui WebView vecchi senza Proxy (es. Chrome
// 44 dei box Android 6 usati come display promo in Fully Kiosk) qualunque
// pagina crasherebbe. Lì si rinuncia all'ottimizzazione e si ri-renderizza
// a ogni cambiamento; altrove resta il comportamento di default.
const queryClient = new QueryClient(
  typeof Proxy === 'undefined' ? { defaultOptions: { queries: { notifyOnChangeProps: 'all' } } } : undefined,
);

/**
 * Registrazione del service worker PWA: solo su sito/browser, mai dentro
 * l'app Android nativa (già "installata", non le serve funzionare offline)
 * — un service worker lì intercetta le richieste con una cache precache che
 * sopravvive sia ai redeploy del sito sia alla reinstallazione dell'APK
 * (l'update-install non svuota lo storage privato dell'app), facendo
 * vedere all'app una versione vecchia del sito a tempo indeterminato.
 * Se l'app ne ha già uno registrato da prima di questo fix, lo rimuove.
 */
if ('serviceWorker' in navigator) {
  if (isNativeApp()) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
    }
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' });
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <DynamicThemeProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </DynamicThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
