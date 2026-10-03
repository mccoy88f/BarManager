import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { DynamicThemeProvider } from './components/DynamicThemeProvider';
import { ToastProvider } from './components/ToastProvider';
import App from './App';

const queryClient = new QueryClient();

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
  if (Capacitor.isNativePlatform()) {
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
