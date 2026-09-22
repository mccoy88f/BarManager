import * as qz from 'qz-tray';

/** Lavoro di stampa preparato dal backend (solo contenuto, mai inviato da lì). */
export type PrintJobResponse =
  | { ready: true; host: string; port: number; dataBase64: string }
  | { ready: false; reason: string };

export interface PrintOutcome {
  printed: boolean;
  reason?: string;
}

let connecting: Promise<void> | null = null;

async function ensureConnected(): Promise<void> {
  if (qz.websocket.isActive()) return;
  if (!connecting) {
    connecting = qz.websocket.connect().catch((err) => {
      connecting = null;
      throw err;
    });
  }
  await connecting;
}

/**
 * Invia un lavoro di stampa ESC/POS a QZ Tray (installato sul PC del
 * locale), che lo consegna alla stampante di rete via TCP direttamente
 * dalla LAN del locale: la connessione non parte più dal server, che
 * spesso non la raggiunge (es. hosting cloud, v. docs/DEVELOPMENT.md §9.2).
 * Richiede che QZ Tray sia installato e in esecuzione sul dispositivo da
 * cui si stampa (https://qz.io/download/).
 */
async function printViaQzTray(job: { host: string; port: number; dataBase64: string }): Promise<void> {
  await ensureConnected();
  const config = qz.configs.create({ host: job.host, port: String(job.port) });
  await qz.print(config, [
    { type: 'raw', format: 'command', flavor: 'base64', data: job.dataBase64 },
  ]);
}

/**
 * Consegna un lavoro di stampa preparato dal backend: se non era pronto
 * (nessuna stampante configurata, non trovata...) restituisce il motivo
 * così com'è; altrimenti tenta l'invio dal browser via QZ Tray,
 * riconducendo qualunque errore (QZ Tray non in esecuzione, stampante
 * irraggiungibile dalla rete locale, ...) a un unico motivo "QZ_ERROR".
 */
export async function deliverPrintJob(job: PrintJobResponse): Promise<PrintOutcome> {
  if (!job.ready) return { printed: false, reason: job.reason };
  try {
    await printViaQzTray(job);
    return { printed: true };
  } catch {
    return { printed: false, reason: 'QZ_ERROR' };
  }
}
