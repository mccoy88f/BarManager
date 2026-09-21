import { Controller, Get, NotFoundException, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { MenuService } from './menu.service';

/**
 * Menù pubblico, senza login: risolto dal sotto-dominio (TenantMiddleware).
 * In sviluppo locale, senza sotto-domini, si può passare `?venueSlug=...`.
 */
@Controller('public/menu')
export class PublicMenuController {
  constructor(
    private menuService: MenuService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async getMenu(@Req() req: Request, @Query('venueSlug') venueSlug?: string) {
    let venueId = req.venue?.id;

    if (!venueId && venueSlug) {
      const venue = await this.prisma.venue.findFirst({
        where: { slug: venueSlug, active: true },
      });
      venueId = venue?.id;
    }

    if (!venueId) {
      throw new NotFoundException('Locale non trovato');
    }

    return this.menuService.getPublicMenu(venueId);
  }
}
