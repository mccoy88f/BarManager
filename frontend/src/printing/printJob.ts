/** Contenuto testuale preparato dal backend (titolo/righe/piè di pagina). */
export type PrintJobResponse =
  | { ready: true; title: string; lines: string[]; footer?: string[] }
  | { ready: false; reason: string };

export interface PrintOutcome {
  printed: boolean;
  reason?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Stampa un contenuto testuale con la stampa standard del browser:
 * apre un iframe nascosto con una pagina formattata a larghezza
 * scontrino e chiama print(). Su Windows/macOS/Linux usa la stampante
 * di sistema; su Android, se installato, RawBT compare come stampante
 * nel dialogo e consegna il contenuto a una stampante ESC/POS via
 * WiFi/LAN, Bluetooth o USB — nessuna libreria browser può parlare
 * direttamente a una stampante di rete (v. docs/DEVELOPMENT.md §9.2).
 */
function printContent(content: { title: string; lines: string[]; footer?: string[] }): void {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  const body = [content.title.toUpperCase(), '-'.repeat(32), ...content.lines];
  if (content.footer?.length) {
    body.push('-'.repeat(32), ...content.footer);
  }

  // Altezza fissa (non "auto": con "auto" alcuni browser scartano la
  // dimensione personalizzata e tornano a un foglio A4/Letter intero) ma
  // proporzionata al contenuto, non un valore enorme fisso: con una pagina
  // di migliaia di mm e solo poche righe di testo in cima, l'anteprima di
  // stampa mostra quel testo rimpicciolito a un puntino, praticamente
  // indistinguibile da una pagina vuota.
  const heightMm = Math.max(40, body.length * 4.2 + 10);

  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: 80mm ${heightMm}mm; margin: 0; }
      body {
        margin: 0;
        padding: 3mm;
        width: 74mm;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>${body.map(escapeHtml).join('\n')}</body>
</html>`);
  doc.close();

  let triggered = false;
  const triggerPrint = () => {
    if (triggered) return;
    triggered = true;
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  };

  iframe.onload = triggerPrint;
  setTimeout(triggerPrint, 300); // alcuni browser non emettono onload dopo document.write
}

/**
 * Consegna un lavoro di stampa preparato dal backend: se non era pronto
 * (nessuna stampante configurata, non trovata...) restituisce il
 * motivo così com'è; altrimenti apre il dialogo di stampa standard del
 * browser con il contenuto. Non c'è modo di sapere se l'utente ha
 * effettivamente confermato la stampa dal dialogo: si considera
 * "stampato" appena il dialogo viene aperto.
 */
export function deliverPrintJob(job: PrintJobResponse): PrintOutcome {
  if (!job.ready) return { printed: false, reason: job.reason };
  printContent(job);
  return { printed: true };
}
