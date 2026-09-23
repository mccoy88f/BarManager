import { Module } from '@nestjs/common';
import { HaccpService } from './haccp.service';
import { HaccpController } from './haccp.controller';
import { CleaningService } from './cleaning.service';
import { CleaningController } from './cleaning.controller';

@Module({
  controllers: [HaccpController, CleaningController],
  providers: [HaccpService, CleaningService],
})
export class HaccpModule {}
