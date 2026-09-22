import { Module } from '@nestjs/common';
import { LoyverseController } from './loyverse.controller';
import { LoyverseService } from './loyverse.service';
import { LoyverseSyncService } from './loyverse-sync.service';

@Module({
  controllers: [LoyverseController],
  providers: [LoyverseService, LoyverseSyncService],
})
export class LoyverseModule {}
