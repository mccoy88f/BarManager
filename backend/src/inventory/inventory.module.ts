import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { MailService } from './mail.service';
import { PrintingModule } from '../printing/printing.module';

@Module({
  imports: [PrintingModule],
  controllers: [CatalogController, OrdersController],
  providers: [CatalogService, OrdersService, MailService],
})
export class InventoryModule {}
