import { api } from '../api/client';

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

interface AppSettingsPlugin {
  getDomain(): Promise<{ domain: string | null }>;
  openDomainSettings(): Promise<void>;
}

// @capacitor/core caricato solo nell'app nativa, con import dinamico: già
// al caricamento del modulo registra i propri plugin web (Cookies, Http...)
// tramite Proxy, che sui WebView vecchi non esiste — importarlo
// staticamente faceva crashare l'intero sito (pagina bianca) sul WebView di
// sistema Chrome 44 dei box Android 6 usati come display promo in Fully Kiosk.
const plugins = new Map<string, Promise<unknown>>();
function nativePlugin<T>(name: string): Promise<T> {
  if (!plugins.has(name)) {
    plugins.set(name, import('@capacitor/core').then((m) => m.registerPlugin<T>(name)));
  }
  return plugins.get(name) as Promise<T>;
}
const escpos = () => nativePlugin<EscposPlugin>('Escpos');
export const appSettings = () => nativePlugin<AppSettingsPlugin>('AppSettings');

/**
 * true solo dentro l'app Android nativa BarManager, mai su sito/PWA (§5.11 di
 * docs/DEVELOPMENT.md). Stesso controllo di Capacitor.isNativePlatform() (il
 * bridge iniettato dal runtime nativo), senza importare @capacitor/core.
 */
export const isNativeApp = (): boolean => {
  const win = window as unknown as { androidBridge?: unknown; webkit?: { messageHandlers?: { bridge?: unknown } } };
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
    printers.map(async (p) => (await escpos()).print({ host: p.host, port: p.port, sections })),
  );
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length > 0) {
    throw new Error(failures.map((f) => String((f.reason as Error)?.message ?? f.reason)).join(' / '));
  }
}

/** Test di stampa (§5.11): stampante scelta esplicitamente dall'admin, non risolta per tipo. */
export async function printOnPrinter(host: string, port: number, sections: ReceiptSection[]): Promise<void> {
  await (await escpos()).print({ host, port, sections });
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
