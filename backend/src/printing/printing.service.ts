import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PrintJobContent {
  title: string;
  lines: string[];
  footer?: string[];
}

/**
 * Prepara solo il contenuto testuale da stampare (titolo/righe/piè di
 * pagina): la consegna avviene condividendo il PDF a scontrino generato
 * da PdfService.buildReceiptDocument con l'app di stampa del sistema
 * operativo (v. frontend/src/printing/printJob.ts), non da qui.
 */
@Injectable()
export class PrintingService {
  constructor(private prisma: PrismaService) {}

  /** Prepara una ricevuta di prova per una stampante specifica, per verificarne la configurazione. */
  async buildTestJob(printerId: string): Promise<PrintJobContent> {
    const printer = await this.prisma.printer.findUniqueOrThrow({ where: { id: printerId } });

    return {
      title: 'Test di stampa',
      lines: [
        `Stampante: ${printer.name}`,
        `Data: ${new Date().toLocaleString('it-IT')}`,
        '',
        'Se leggi questo messaggio,',
        'la stampante è configurata correttamente.',
      ],
    };
  }
}
