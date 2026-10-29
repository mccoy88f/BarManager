import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Supporto ai WebView dei vecchi box/tablet Android usati come display
    // promo in Fully Kiosk. Due casi, entrambi finivano in pagina bianca:
    // - WebView senza ES module: ignora <script type="module">, gli serve
    //   il bundle ES5 legacy (caricato via nomodule, i browser moderni non
    //   lo scaricano);
    // - WebView con ES module ma vecchio (es. Chrome 84 su Android 6):
    //   carica il bundle moderno ma crasha su API recenti (.at(),
    //   structuredClone, Object.hasOwn, replaceAll...), quindi il bundle
    //   moderno è compilato per Chrome 64+ con i polyfill necessari.
    legacy({
      targets: ['defaults', 'android >= 4.4', 'chrome >= 37'],
      modernTargets: ['chrome >= 64', 'edge >= 79', 'firefox >= 67', 'safari >= 12', 'ios >= 12'],
      modernPolyfills: true,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      // Registrazione del service worker fatta a mano in main.tsx, non
      // iniettata automaticamente in index.html: quest'ultima girava
      // incondizionatamente anche dentro la WebView dell'app Android
      // nativa, dove un service worker non serve a nulla (l'app è già
      // "installata", non le serve funzionare offline) ma fa danni - la
      // sua cache precache dei file sopravvive sia ai redeploy del sito
      // sia alla reinstallazione dell'APK (l'update-install di un APK non
      // svuota lo storage privato dell'app), facendo vedere all'app una
      // versione del sito permanentemente vecchia.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'display-promo-fallback.svg'],
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // I chunk legacy servono solo ai browser senza supporto ES module,
        // che comunque non hanno service worker: non precacharli.
        globIgnores: ['**/*-legacy-*.js'],
        // Senza questa esclusione, il service worker intercetta come
        // "navigazione" anche un GET a un endpoint pubblico del backend
        // aperto direttamente nel browser (es. il redirect di tracciamento
        // del pulsante CTA Marketing, /api/public/communications/:id/click)
        // e risponde con la shell della SPA invece di lasciar passare la
        // richiesta alla rete — su un browser che ha già visitato il
        // pannello admin di quel locale (service worker già installato),
        // il risultato è una pagina bianca perché nessuna route client
        // corrisponde a quel percorso, e la richiesta non arriva mai al
        // backend (bug segnalato: il link CTA non reindirizzava più).
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
      },
      manifest: {
        name: 'Bar Management',
        short_name: 'Bar Management',
        description: 'Gestione presenze, HACCP e inventario per bar/ristoranti',
        theme_color: '#1E5F74',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Stesso schema del proxy Nginx di produzione: frontend e API sullo
    // stesso origin anche in sviluppo, nessuna gestione CORS lato client.
    // "backend" risolve al servizio Docker Compose; in esecuzione fuori
    // da Docker, sovrascrivi con `VITE_DEV_PROXY_TARGET`.
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_PROXY_TARGET || 'http://backend:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.VITE_DEV_PROXY_TARGET || 'http://backend:3000',
        changeOrigin: true,
      },
    },
  },
});
