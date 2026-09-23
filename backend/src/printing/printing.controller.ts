import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PdfService } from '../reports/pdf.service';
import { RenderPrintPdfDto } from './dto/render-print-pdf.dto';

/**
 * Convertitore generico da un job di stampa (titolo/righe/piè di pagina,
 * lo stesso contenuto già usato per la stampa da browser) a un vero PDF
 * largo come uno scontrino: il frontend lo condivide poi con l'app di
 * stampa (RawBT) via Web Share API. Serve perché il dialogo di stampa di
 * sistema, su alcuni dispositivi Android, ignora la dimensione pagina
 * richiesta via CSS (@page) e stampa comunque su un foglio A4; un PDF
 * vero invece porta la sua dimensione pagina nei metadati, che RawBT
 * legge ed usa correttamente.
 */
@Controller('printing')
@UseGuards(JwtAuthGuard)
export class PrintingController {
  constructor(private pdf: PdfService) {}

  @Post('render-pdf')
  async renderPdf(@Body() dto: RenderPrintPdfDto, @Res() res: Response) {
    const buffer = await this.pdf.buildReceiptDocument([dto]);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="ricevuta.pdf"',
    });
    res.send(buffer);
  }
}
