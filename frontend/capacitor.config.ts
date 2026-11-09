import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Config "statica" per la build: la webDir è reale (serve a Capacitor per
 * sapere cosa impacchettare come fallback/schermata iniziale), ma l'app
 * nativa non la usa davvero per il lavoro quotidiano — una volta
 * configurato un dominio (§5.11), Android (MainActivity) e iOS
 * (MainBridgeViewController) sovrascrivono l'URL del server a runtime
 * verso https://{slug}.{ROOT_DOMAIN} del locale (SharedPreferences /
 * UserDefaults). Senza dominio (primo avvio) mostrano DomainSetup, non
 * la WebView.
 */
const config: CapacitorConfig = {
  appId: 'it.mccoy88f.barmanager',
  appName: 'BarManager',
  webDir: 'dist',
};

export default config;
