import { Module } from '@nestjs/common';
import { OnlineOrdersService } from './online-orders.service';
import { OnlineOrdersController } from './online-orders.controller';
import { PublicOnlineOrdersController } from './public-online-orders.controller';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [CustomersModule],
  controllers: [OnlineOrdersController, PublicOnlineOrdersController],
  providers: [OnlineOrdersService],
})
export class OnlineOrdersModule {}
