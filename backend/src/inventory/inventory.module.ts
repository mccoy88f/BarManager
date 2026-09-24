import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';

@Module({
  controllers: [CatalogController, OrdersController],
  providers: [CatalogService, OrdersService],
})
export class InventoryModule {}
