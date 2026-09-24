import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerDedupeService } from './customer-dedupe.service';
import { CustomersController } from './customers.controller';
import { PublicCustomersController } from './public-customers.controller';

@Module({
  controllers: [CustomersController, PublicCustomersController],
  providers: [CustomersService, CustomerDedupeService],
  exports: [CustomersService],
})
export class CustomersModule {}
