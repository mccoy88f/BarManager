function receiptFileName(title: string): string {
  const safe = title.replace(/[^\w\- ]+/g, '').trim();
  return `${safe || 'ricevuta'}.pdf`;
}

/**
 * Condivide un PDF a scontrino (80mm, generato da PdfService.
 * buildReceiptDocument sul backend) con l'app di stampa di sistema:
 * con la Web Share API disponibile (Android/iOS) lo condivide
 * direttamente con RawBT o l'app scelta dall'utente, che legge la
 * dimensione pagina reale dai metadati del PDF invece di passare per il
 * dialogo di stampa di sistema, che su alcuni dispositivi la ignora (v.
 * docs/DEVELOPMENT.md §9.2). Senza Web Share (desktop) lo apre in una
 * nuova scheda per la stampa/il salvataggio standard del browser.
 */
export async function shareReceiptPdf(blob: Blob, title: string): Promise<void> {
  const file = new File([blob], receiptFileName(title), { type: 'application/pdf' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (err) {
      // Condivisione annullata dall'utente: non è un errore.
      if (err instanceof Error && err.name === 'AbortError') return;
      // Altri errori (nessuna app compatibile, ecc.): prosegui con il fallback sotto.
    }
  }

  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
