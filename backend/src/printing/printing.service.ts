import { Injectable, Logger } from '@nestjs/common';
import { printer as ThermalPrinter, types as PrinterTypes } from 'node-thermal-printer';
import { PrismaService } from '../prisma/prisma.service';
import { PrinterUsage } from '@prisma/client';

/**
 * Invia contenuto ESC/POS a una stampante Epson (o compatibile) di rete,
 * raggiunta via TCP diretto sulla porta configurata (default 9100).
 * Le stampanti sono censite dall'admin nel modello `Printer`.
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

  /** Stampa una ricevuta di prova su una stampante specifica, per verificarne la configurazione. */
  async printTest(
    venueId: string,
    printerId: string,
  ): Promise<{ printed: boolean; reason?: string }> {
    const printerConfig = await this.prisma.printer.findUnique({ where: { id: printerId } });
    if (!printerConfig || printerConfig.venueId !== venueId) {
      return { printed: false, reason: 'NOT_FOUND' };
    }

    const printer = this.createThermalPrinter(printerConfig.host, printerConfig.port);

    try {
      const isConnected = await printer.isPrinterConnected();
      if (!isConnected) {
        return { printed: false, reason: 'PRINTER_UNREACHABLE' };
      }

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
      await printer.execute();
      return { printed: true };
    } catch (err) {
      this.logger.error(`Errore di stampa (test): ${(err as Error).message}`);
      return { printed: false, reason: 'PRINT_ERROR' };
    }
  }

  /**
   * Stampa un report tabellare semplice (righe di testo pre-formattate)
   * usata sia per il report HACCP giornaliero sia per la checklist ordini.
   */
  async printReport(
    venueId: string,
    usage: PrinterUsage,
    opts: { title: string; lines: string[]; footer?: string[] },
  ): Promise<{ printed: boolean; reason?: string }> {
    const printerConfig = await this.getPrinter(venueId, usage);
    if (!printerConfig) {
      this.logger.warn(`Nessuna stampante configurata per uso=${usage} venue=${venueId}`);
      return { printed: false, reason: 'NO_PRINTER_CONFIGURED' };
    }

    const printer = this.createThermalPrinter(printerConfig.host, printerConfig.port);

    try {
      const isConnected = await printer.isPrinterConnected();
      if (!isConnected) {
        return { printed: false, reason: 'PRINTER_UNREACHABLE' };
      }

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
      await printer.execute();
      return { printed: true };
    } catch (err) {
      this.logger.error(`Errore di stampa: ${(err as Error).message}`);
      return { printed: false, reason: 'PRINT_ERROR' };
    }
  }
}
