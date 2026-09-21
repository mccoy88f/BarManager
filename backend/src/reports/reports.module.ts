import { Global, Module } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { XlsxService } from './xlsx.service';

@Global()
@Module({
  providers: [PdfService, XlsxService],
  exports: [PdfService, XlsxService],
})
export class ReportsModule {}
