import { Module } from '@nestjs/common';
import { PrintingService } from './printing.service';
import { PrinterController } from './printer.controller';
import { PrintingController } from './printing.controller';

@Module({
  controllers: [PrinterController, PrintingController],
  providers: [PrintingService],
  exports: [PrintingService],
})
export class PrintingModule {}
