import { Module } from '@nestjs/common';
import { PrintingService } from './printing.service';
import { PrinterController } from './printer.controller';

@Module({
  controllers: [PrinterController],
  providers: [PrintingService],
  exports: [PrintingService],
})
export class PrintingModule {}
