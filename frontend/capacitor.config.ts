import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Config "statica" per la build: la webDir è reale (serve a Capacitor per
 * sapere cosa impacchettare come fallback/schermata iniziale), ma l'app
 * nativa non la usa davvero per il lavoro quotidiano — una volta
 * configurato un dominio (§5.11 di docs/DEVELOPMENT.md), MainActivity
 * sovrascrive l'URL del server a runtime (CapConfig.Builder.setServerUrl)
 * verso https://{slug}.{ROOT_DOMAIN} del locale, letto da SharedPreferences.
 * Senza un dominio configurato (primo avvio) l'app mostra prima la
 * schermata nativa DomainSetupActivity, non la WebView.
 */
const config: CapacitorConfig = {
  appId: 'it.mccoy88f.barmanager',
  appName: 'BarManager',
  webDir: 'dist',
};

export default config;
