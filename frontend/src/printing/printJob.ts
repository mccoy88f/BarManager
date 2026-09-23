import { api } from '../api/client';

/** Contenuto testuale preparato dal backend (titolo/righe/piè di pagina). */
export type PrintJobResponse =
  | { ready: true; title: string; lines: string[]; footer?: string[] }
  | { ready: false; reason: string };

export interface PrintOutcome {
  printed: boolean;
  reason?: string;
}

function receiptFileName(title: string): string {
  const safe = title.replace(/[^\w\- ]+/g, '').trim();
  return `${safe || 'ricevuta'}.pdf`;
}

/**
 * Consegna un contenuto testuale come vero PDF largo come uno scontrino
 * (80mm, stesso formato dell'esportazione PDF degli ordini): il dialogo
 * di stampa di sistema, su alcuni dispositivi Android, ignora la
 * dimensione pagina richiesta via CSS e stampa comunque su un foglio A4
 * (v. docs/DEVELOPMENT.md §9.2); un PDF vero invece porta la sua
 * dimensione pagina nei metadati, che l'app di stampa (RawBT) legge e usa
 * correttamente. Con la Web Share API disponibile (Android/iOS) il PDF
 * viene condiviso direttamente con RawBT; altrimenti si apre in una
 * nuova scheda per la stampa/il salvataggio standard del browser.
 */
async function deliverReceipt(content: {
  title: string;
  lines: string[];
  footer?: string[];
}): Promise<void> {
  const response = await api.post('/printing/render-pdf', content, { responseType: 'blob' });
  const blob = response.data as Blob;
  const file = new File([blob], receiptFileName(content.title), { type: 'application/pdf' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: content.title });
      return;
    } catch (err) {
      // Condivisione annullata dall'utente: non è un errore, semplicemente non si stampa.
      if (err instanceof Error && err.name === 'AbortError') return;
      // Altri errori (nessuna app compatibile, ecc.): prosegui con il fallback sotto.
    }
  }

  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Consegna un lavoro di stampa preparato dal backend: se non era pronto
 * (nessuna stampante configurata, non trovata...) restituisce il motivo
 * così com'è; altrimenti genera e consegna il PDF a scontrino. Non c'è
 * modo di sapere se l'utente ha effettivamente confermato la stampa: si
 * considera "stampato" appena la condivisione/apertura del PDF avviene.
 */
export async function deliverPrintJob(job: PrintJobResponse): Promise<PrintOutcome> {
  if (!job.ready) return { printed: false, reason: job.reason };
  await deliverReceipt(job);
  return { printed: true };
}
