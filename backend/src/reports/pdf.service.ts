import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface ReceiptSection {
  title: string;
  lines: string[];
  footer?: string[];
  /** Intestazione (es. nome e indirizzo dell'attività), sopra il titolo. */
  letterhead?: string[];
}

// 80mm di carta termica (formato scontrino/POS), 3mm di margine per lato:
// stessa larghezza usata da frontend/src/printing/printJob.ts per la
// stampa via window.print, così un domani lo stesso testo può andare
// direttamente a una stampante ESC/POS senza dover riformattare nulla.
const RECEIPT_WIDTH_PT = 226.77; // 80mm
const RECEIPT_MARGIN_PT = 8.5; // 3mm
const RECEIPT_CONTENT_WIDTH_PT = RECEIPT_WIDTH_PT - RECEIPT_MARGIN_PT * 2;
const RECEIPT_FONT_SIZE = 9;
const RECEIPT_LINE_GAP = 3;
const RECEIPT_SEPARATOR = '-'.repeat(32);

@Injectable()
export class PdfService {
  /**
   * Genera un PDF tabellare semplice (titolo + righe di testo) via callback,
   * usato per report presenze/HACCP. Ritorna il buffer completo.
   */
  async buildDocument(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      build(doc);

      doc.end();
    });
  }

  /**
   * Genera un PDF largo come uno scontrino (80mm), monospazio, una pagina
   * per sezione: lo stesso identico contenuto testuale (titolo/righe/piè
   * di pagina) già usato per la ristampa POS via browser, così il PDF
   * scaricato ha lo stesso formato di ciò che uscirebbe da una stampante
   * ESC/POS, invece di un foglio A4.
   */
  async buildReceiptDocument(sections: ReceiptSection[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (sections.length === 0) {
        resolve(Buffer.alloc(0));
        return;
      }

      const chunks: Buffer[] = [];
      let doc: PDFKit.PDFDocument | undefined;

      // Documento "di misura", mai scritto nel PDF finale: serve solo a
      // chiedere a PDFKit quanto spazio occuperà il testo tenendo conto
      // dell'a-capo automatico sulle righe più lunghe della larghezza
      // scontrino (es. prodotto+quantità+importo). Stimare l'altezza
      // contando una riga per ogni voce (senza considerare l'a-capo)
      // sottodimensiona la pagina: il testo che eccede finisce spostato
      // silenziosamente da PDFKit su una seconda pagina, che l'app di
      // stampa POS potrebbe non stampare.
      const measurer = new PDFDocument({ margin: 0 });
      measurer.font('Courier').fontSize(RECEIPT_FONT_SIZE);
      const textOptions = { width: RECEIPT_CONTENT_WIDTH_PT, lineGap: RECEIPT_LINE_GAP };

      for (const section of sections) {
        const body = [
          ...(section.letterhead?.length ? [...section.letterhead, ''] : []),
          section.title.toUpperCase(),
          RECEIPT_SEPARATOR,
          ...section.lines,
          ...(section.footer?.length ? [RECEIPT_SEPARATOR, ...section.footer] : []),
        ];
        const contentHeight = body.reduce(
          (sum, line) => sum + measurer.heightOfString(line, textOptions),
          0,
        );
        const height = RECEIPT_MARGIN_PT * 2 + contentHeight + 10;
        const pageOptions = {
          size: [RECEIPT_WIDTH_PT, height] as [number, number],
          margin: RECEIPT_MARGIN_PT,
        };

        if (!doc) {
          doc = new PDFDocument(pageOptions);
          doc.on('data', (chunk) => chunks.push(chunk));
          doc.on('end', () => resolve(Buffer.concat(chunks)));
          doc.on('error', reject);
        } else {
          doc.addPage(pageOptions);
        }

        doc.font('Courier').fontSize(RECEIPT_FONT_SIZE);
        for (const line of body) {
          doc.text(line, textOptions);
        }
      }

      doc!.end();
    });
  }
}
