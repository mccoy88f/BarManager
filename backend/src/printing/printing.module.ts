import { Module } from '@nestjs/common';
import { PrintingService } from './printing.service';
import { PrinterController } from './printer.controller';

@Module({
  controllers: [PrinterController],
  providers: [PrintingService],
})
export class PrintingModule {}
