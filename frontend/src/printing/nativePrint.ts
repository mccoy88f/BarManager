import { api } from '../api/client';
import { formatErrorMessage } from '../utils/format';

export interface ReceiptLine {
  text: string;
  bold?: boolean;
}

export interface ReceiptSection {
  title: string;
  lines: (string | ReceiptLine)[];
  footer?: (string | ReceiptLine)[];
  letterhead?: string[];
}

interface EscposPlugin {
  print(options: { host: string; port: number; sections: ReceiptSection[] }): Promise<void>;
}

interface RchFiscalPlugin {
  print(options: { host: string; port: number; payload: string }): Promise<void>;
}

export interface AppInfoResult {
  versionName: string;
  versionCode: number;
  domain: string | null;
  packageName: string;
}

export interface UpdateInfoResult {
  currentVersion: string;
  hasUpdate: boolean;
  latestVersion: string;
  downloadUrl?: string;
  apkName?: string;
  sizeBytes?: number;
  releaseNotes?: string;
}

export interface DownloadProgress {
  percent: number;
  downloadedMb: number;
  totalMb: number;
}

export interface AppSettingsPlugin {
  getDomain(): Promise<{ domain: string | null }>;
  openDomainSettings(): Promise<void>;
  getAppInfo(): Promise<AppInfoResult>;
  checkForUpdate(): Promise<UpdateInfoResult>;
  downloadAndInstallUpdate(options: { downloadUrl: string }): Promise<{ success: boolean }>;
  addListener?(
    eventName: 'updateProgress',
    listenerFunc: (progress: DownloadProgress) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

// @capacitor/core caricato solo nell'app nativa, con import dinamico: già
// al caricamento del modulo registra i propri plugin web (Cookies, Http...)
// tramite Proxy, che sui WebView vecchi non esiste — importarlo
// staticamente faceva crashare l'intero sito (pagina bianca) sul WebView di
// sistema Chrome 44 dei box Android 6 usati come display promo in Fully Kiosk.
// registerPlugin() restituisce un Proxy con un metodo then(). Se quel Proxy
// è il valore di ritorno di un Promise.then(), la Promise lo "adotta" come
// thenable e chiama il metodo nativo "then", che non esiste: la chiamata
// resta appesa ("Escpos.then() is not implemented") e il pulsante di stampa
// rimane disabilitato. Il plugin va quindi sempre chiuso in un oggetto
// senza then(), mai restituito direttamente da una Promise.
const pluginBoxes = new Map<string, Promise<{ plugin: unknown }>>();
function nativePlugin<T>(name: string): Promise<{ plugin: T }> {
  let box = pluginBoxes.get(name);
  if (!box) {
    box = import('@capacitor/core').then((m) => ({ plugin: m.registerPlugin<T>(name) }));
    pluginBoxes.set(name, box);
  }
  return box as Promise<{ plugin: T }>;
}
const escpos = () => nativePlugin<EscposPlugin>('Escpos');
const rchFiscal = () => nativePlugin<RchFiscalPlugin>('RchFiscal');
export const appSettings = () => nativePlugin<AppSettingsPlugin>('AppSettings');

export interface DevicePermissionState {
  notifications: string;
  camera: string;
  location: string;
}

export interface NativePushPlugin {
  start(options: { apiBase: string; token: string }): Promise<{ started: boolean }>;
  consumePath(): Promise<{ path: string | null }>;
  permissionStatus(): Promise<DevicePermissionState>;
  requestNotifications(): Promise<{ notifications: string }>;
  requestDevicePermissions(): Promise<DevicePermissionState>;
  openAppSettings(): Promise<void>;
}
export const nativePush = () => nativePlugin<NativePushPlugin>('NativePush');

/**
 * true solo dentro l'app nativa BarManager (Android/iOS), mai su sito/PWA (§5.11).
 * Stesso controllo di Capacitor.isNativePlatform() (il bridge iniettato dal
 * runtime nativo), senza importare staticamente @capacitor/core.
 */
export const isNativeApp = (): boolean => {
  const win = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    androidBridge?: unknown;
    webkit?: { messageHandlers?: { bridge?: unknown } };
  };
  if (win.Capacitor?.isNativePlatform?.()) return true;
  if (win.Capacitor?.getPlatform?.() === 'android' || win.Capacitor?.getPlatform?.() === 'ios') return true;
  return !!(win.androidBridge || win.webkit?.messageHandlers?.bridge);
};

interface PrinterRow {
  id: string;
  host: string;
  port: number;
  usages: string[];
  active: boolean;
}

/**
 * Stampa su tutte le stampanti del locale assegnate a questo tipo di
 * documento (molti-a-molti, a scelta dell'admin — §5.11): nessuna stampante
 * assegnata è un errore esplicito, non un fallimento silenzioso.
 */
export async function printOnAssignedPrinters(usage: string, sections: ReceiptSection[]): Promise<void> {
  const printers = (await api.get<PrinterRow[]>('/printers')).data.filter(
    (p) => p.active && p.usages.includes(usage),
  );
  if (printers.length === 0) {
    throw new Error(
      'Nessuna stampante configurata per questo tipo di documento: assegnala in Impostazioni → Stampanti.',
    );
  }

  const results = await Promise.allSettled(
    printers.map(async (p) => (await escpos()).plugin.print({ host: p.host, port: p.port, sections })),
  );
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length > 0) {
    throw new Error(failures.map((f) => formatErrorMessage(f.reason)).join(' / '));
  }
}

/** Test di stampa (§5.11): stampante scelta esplicitamente dall'admin, non risolta per tipo. */
export async function printOnPrinter(host: string, port: number, sections: ReceiptSection[]): Promise<void> {
  await (await escpos()).plugin.print({ host, port, sections });
}

/**
 * Scontrino fiscale RCH PRINT! F: TCP raw XON/XOFF dall'APK Android.
 * Su sito/PWA non è disponibile (nessun socket TCP dal browser).
 */
export async function printRchFiscal(host: string, port: number, payload: string): Promise<void> {
  if (!isNativeApp()) {
    throw new Error('Lo scontrino fiscale RCH si stampa solo dall\'app Android sulla rete del locale.');
  }
  await (await rchFiscal()).plugin.print({ host, port, payload });
}

interface PrintOrShareOptions {
  /** Tipo di documento (PrinterUsage) per l'instradamento nativo; omesso per il test stampante (stampante esplicita). */
  usage?: string;
  /** Endpoint che restituisce { sections: ReceiptSection[] } — usato solo nell'app nativa. */
  escposUrl: string;
  escposMethod?: 'get' | 'post';
  escposBody?: unknown;
  /** Endpoint che restituisce il PDF — usato solo su sito/PWA (fallback via window.print()/condivisione). */
  printPdf: () => Promise<void>;
  /** Solo per il test stampante: host/porta espliciti invece della risoluzione per tipo. */
  explicitPrinter?: { host: string; port: number };
}

/**
 * Punto unico richiamato da ogni pulsante di stampa del progetto: nell'app
 * nativa stampa direttamente in ESC/POS sulle stampanti assegnate,
 * altrimenti ricade sul flusso PDF+condivisione già esistente per sito/PWA
 * (§5.11 di docs/DEVELOPMENT.md).
 */
export async function printOrShare(options: PrintOrShareOptions): Promise<void> {
  if (!isNativeApp()) {
    await options.printPdf();
    return;
  }

  const response =
    options.escposMethod === 'post'
      ? await api.post<{ sections: ReceiptSection[] }>(options.escposUrl, options.escposBody ?? {})
      : await api.get<{ sections: ReceiptSection[] }>(options.escposUrl);
  const sections = response.data.sections;

  if (options.explicitPrinter) {
    await printOnPrinter(options.explicitPrinter.host, options.explicitPrinter.port, sections);
    return;
  }
  if (!options.usage) {
    throw new Error('Tipo di documento mancante per la stampa nativa.');
  }
  await printOnAssignedPrinters(options.usage, sections);
}
