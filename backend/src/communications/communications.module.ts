import { Module } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { CommunicationsController } from './communications.controller';
import { PublicCommunicationsController } from './public-communications.controller';

@Module({
  controllers: [CommunicationsController, PublicCommunicationsController],
  providers: [CommunicationsService],
})
export class CommunicationsModule {}
