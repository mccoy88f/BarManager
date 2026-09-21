import { Module } from '@nestjs/common';
import { HaccpService } from './haccp.service';
import { HaccpController } from './haccp.controller';
import { PrintingModule } from '../printing/printing.module';

@Module({
  imports: [PrintingModule],
  controllers: [HaccpController],
  providers: [HaccpService],
})
export class HaccpModule {}
