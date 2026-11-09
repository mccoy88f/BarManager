import { Module } from '@nestjs/common';
import { LoyverseController } from './loyverse.controller';
import { LoyverseService } from './loyverse.service';
import { LoyverseSyncService } from './loyverse-sync.service';
import { LoyverseSyncSchedulerService } from './loyverse-sync-scheduler.service';

@Module({
  controllers: [LoyverseController],
  providers: [LoyverseService, LoyverseSyncService, LoyverseSyncSchedulerService],
})
export class LoyverseModule {}
