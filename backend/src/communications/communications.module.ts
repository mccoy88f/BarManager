import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { CommunicationsService } from './communications.service';
import { CommunicationsController } from './communications.controller';
import { PublicCommunicationsController } from './public-communications.controller';

@Module({
  imports: [CustomersModule],
  controllers: [CommunicationsController, PublicCommunicationsController],
  providers: [CommunicationsService],
})
export class CommunicationsModule {}
