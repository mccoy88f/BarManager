import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { MailService } from './mail.service';

@Module({
  controllers: [CatalogController, OrdersController],
  providers: [CatalogService, OrdersService, MailService],
})
export class InventoryModule {}
