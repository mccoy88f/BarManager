import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module';
import { DisplayPromoService } from './display-promo.service';
import { DisplayPromoController } from './display-promo.controller';
import { PublicDisplayPromoController } from './public-display-promo.controller';

@Module({
  imports: [MenuModule],
  controllers: [DisplayPromoController, PublicDisplayPromoController],
  providers: [DisplayPromoService],
})
export class DisplayPromoModule {}
