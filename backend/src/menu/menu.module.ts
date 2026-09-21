import { Module } from '@nestjs/common';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';
import { PublicMenuController } from './public-menu.controller';

@Module({
  controllers: [MenuController, PublicMenuController],
  providers: [MenuService],
})
export class MenuModule {}
