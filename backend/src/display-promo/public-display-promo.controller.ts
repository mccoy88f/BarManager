import { Controller, Get, Param } from '@nestjs/common';
import { DisplayPromoService } from './display-promo.service';

/**
 * Pagina pubblica /display/:screenId (schermi pubblicitari, nessun login):
 * a differenza delle altre pagine pubbliche, l'id dello schermo stesso
 * identifica già il locale — nessuna risoluzione per sottodominio o
 * `?venueSlug=` necessaria qui (ogni display fisico ha un link/QR proprio,
 * generato in DisplayPromoAdmin.tsx).
 */
@Controller('public/display-promo')
export class PublicDisplayPromoController {
  constructor(private displayPromoService: DisplayPromoService) {}

  @Get(':screenId')
  get(@Param('screenId') screenId: string) {
    return this.displayPromoService.getActivePlaylist(screenId);
  }
}
