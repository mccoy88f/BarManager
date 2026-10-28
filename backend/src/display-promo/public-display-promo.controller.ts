import { Controller, Get, NotFoundException, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { DisplayPromoService } from './display-promo.service';

/**
 * Pagina pubblica /display (schermi pubblicitari, nessun login): stessa
 * risoluzione multi-tenant delle altre pagine pubbliche (sottodominio via
 * TenantMiddleware, o `?venueSlug=` in sviluppo locale).
 */
@Controller('public/display-promo')
export class PublicDisplayPromoController {
  constructor(
    private displayPromoService: DisplayPromoService,
    private prisma: PrismaService,
  ) {}

  private async resolveVenueId(req: Request, venueSlug?: string): Promise<string> {
    let venueId = req.venue?.id;
    if (!venueId && venueSlug) {
      const venue = await this.prisma.venue.findFirst({ where: { slug: venueSlug, active: true } });
      venueId = venue?.id;
    }
    if (!venueId) throw new NotFoundException('Locale non trovato');
    return venueId;
  }

  @Get()
  async get(@Req() req: Request, @Query('venueSlug') venueSlug?: string) {
    const venueId = await this.resolveVenueId(req, venueSlug);
    return this.displayPromoService.getActivePlaylist(venueId);
  }
}
