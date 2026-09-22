import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PrinterUsage } from '@prisma/client';

export type PrintJob =
  | { ready: true; title: string; lines: string[]; footer?: string[] }
  | { ready: false; reason: 'NO_PRINTER_CONFIGURED' | 'NOT_FOUND' };

/**
 * Prepara solo il contenuto testuale da stampare (titolo/righe/piè di
 * pagina): l'invio alla stampante avviene con la stampa standard del
 * browser (window.print, v. frontend/src/printing/printJob.ts), non da
 * qui. Un browser non può aprire una connessione diretta a una
 * stampante di rete (nessuna libreria lo permette, v.
 * docs/DEVELOPMENT.md §9.2): la stampante di destinazione la scelgono
 * chi stampa nel dialogo di stampa del sistema operativo — su Android,
 * con RawBT installato, compare lì e consegna il contenuto a una
 * stampante ESC/POS in rete.
 */
@Injectable()
export class PrintingService {
  private readonly logger = new Logger(PrintingService.name);

  constructor(private prisma: PrismaService) {}

  private async getPrinter(venueId: string, usage: PrinterUsage) {
    return this.prisma.printer.findFirst({
      where: { venueId, usages: { has: usage }, active: true },
    });
  }

  /** Prepara una ricevuta di prova per una stampante specifica, per verificarne la configurazione. */
  async buildTestJob(venueId: string, printerId: string): Promise<PrintJob> {
    const printerConfig = await this.prisma.printer.findUnique({ where: { id: printerId } });
    if (!printerConfig || printerConfig.venueId !== venueId) {
      return { ready: false, reason: 'NOT_FOUND' };
    }

    return {
      ready: true,
      title: 'Test di stampa',
      lines: [
        `Stampante: ${printerConfig.name}`,
        `Data: ${new Date().toLocaleString('it-IT')}`,
        '',
        'Se leggi questo messaggio,',
        'la stampante è configurata correttamente.',
      ],
    };
  }

  /**
   * Prepara un report tabellare semplice (righe di testo pre-formattate),
   * usato sia per il report HACCP giornaliero sia per la checklist ordini.
   */
  async buildReportJob(
    venueId: string,
    usage: PrinterUsage,
    opts: { title: string; lines: string[]; footer?: string[] },
  ): Promise<PrintJob> {
    const printerConfig = await this.getPrinter(venueId, usage);
    if (!printerConfig) {
      this.logger.warn(`Nessuna stampante configurata per uso=${usage} venue=${venueId}`);
      return { ready: false, reason: 'NO_PRINTER_CONFIGURED' };
    }

    return { ready: true, ...opts };
  }
}
