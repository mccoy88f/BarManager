import { Global, Module } from '@nestjs/common';
import { PushController, PushFeedController } from './push.controller';
import { PushService } from './push.service';

@Global()
@Module({
  controllers: [PushController, PushFeedController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
