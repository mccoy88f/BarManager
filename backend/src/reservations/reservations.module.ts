import { Module } from '@nestjs/common';
import { TablesService } from './tables.service';
import { TablesController } from './tables.controller';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { PublicReservationsController } from './public-reservations.controller';
import { ReservationsMailService } from './reservations-mail.service';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [CustomersModule],
  controllers: [TablesController, ReservationsController, PublicReservationsController],
  providers: [TablesService, ReservationsService, ReservationsMailService],
})
export class ReservationsModule {}
