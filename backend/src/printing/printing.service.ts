import { Injectable, Logger } from '@nestjs/common';
import { printer as ThermalPrinter, types as PrinterTypes } from 'node-thermal-printer';
import { PrismaService } from '../prisma/prisma.service';
import { PrinterUsage } from '@prisma/client';

export type PrintJob =
  | { ready: true; host: string; port: number; dataBase64: string }
  | { ready: false; reason: 'NO_PRINTER_CONFIGURED' | 'NOT_FOUND' };

/**
 * Prepara contenuto ESC/POS per una stampante Epson (o compatibile) di
 * rete, ma non lo invia: costruisce solo il buffer di comandi. L'invio
 * effettivo (connessione TCP diretta sulla porta configurata, default
 * 9100) avviene dal browser tramite QZ Tray (v.
 * frontend/src/printing/qzPrint.ts), non da qui — il server spesso non è
 * sulla stessa rete locale della stampante (es. hosting cloud, v.
 * docs/DEVELOPMENT.md §9.2), mentre il browser di chi stampa sì. Le
 * stampanti sono censite dall'admin nel modello `Printer`.
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

  private createThermalPrinter(host: string, port: number) {
    return new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${host}:${port}`,
      removeSpecialCharacters: false,
    });
  }

  /** Prepara una ricevuta di prova per una stampante specifica, per verificarne la configurazione. */
  async buildTestJob(venueId: string, printerId: string): Promise<PrintJob> {
    const printerConfig = await this.prisma.printer.findUnique({ where: { id: printerId } });
    if (!printerConfig || printerConfig.venueId !== venueId) {
      return { ready: false, reason: 'NOT_FOUND' };
    }

    const printer = this.createThermalPrinter(printerConfig.host, printerConfig.port);
    printer.alignCenter();
    printer.bold(true);
    printer.println('Test di stampa');
    printer.bold(false);
    printer.drawLine();
    printer.alignLeft();
    printer.println(`Stampante: ${printerConfig.name}`);
    printer.println(`Data: ${new Date().toLocaleString('it-IT')}`);
    printer.newLine();
    printer.alignCenter();
    printer.println('Se leggi questo messaggio,');
    printer.println('la stampante è configurata correttamente.');
    printer.cut();

    return {
      ready: true,
      host: printerConfig.host,
      port: printerConfig.port,
      dataBase64: printer.getBuffer().toString('base64'),
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

    const printer = this.createThermalPrinter(printerConfig.host, printerConfig.port);
    printer.alignCenter();
    printer.bold(true);
    printer.println(opts.title);
    printer.bold(false);
    printer.drawLine();
    printer.alignLeft();
    for (const line of opts.lines) {
      printer.println(line);
    }
    if (opts.footer?.length) {
      printer.drawLine();
      for (const line of opts.footer) {
        printer.println(line);
      }
    }
    printer.cut();

    return {
      ready: true,
      host: printerConfig.host,
      port: printerConfig.port,
      dataBase64: printer.getBuffer().toString('base64'),
    };
  }
}
