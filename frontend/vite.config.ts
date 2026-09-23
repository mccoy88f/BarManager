import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        name: 'BarManager',
        short_name: 'BarManager',
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
