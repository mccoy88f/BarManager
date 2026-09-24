import { Controller, Delete, Get, Patch, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';

/**
 * Pagina pubblica "gestisci i tuoi dati personali" (§5.8 di
 * DEVELOPMENT.md, link in fondo alle email di prenotazione): nessun
 * login, identificata dal `privacyToken` del cliente (unico a livello
 * globale, non solo per locale — è l'unico dato nel link). Permette solo
 * due azioni non distruttive per il resto del sistema: rimuovere il
 * consenso marketing, o eliminare la propria scheda cliente (non le
 * prenotazioni già effettuate, che restano nello storico del locale).
 */
@Controller('public/customers')
export class PublicCustomersController {
  constructor(private customersService: CustomersService) {}

  @Get('privacy')
  getPrivacyPage(@Query('token') token: string) {
    return this.customersService.getForPrivacyPage(token);
  }

  @Patch('privacy/opt-out')
  optOut(@Query('token') token: string) {
    return this.customersService.optOutMarketingByToken(token);
  }

  @Delete('privacy')
  remove(@Query('token') token: string) {
    return this.customersService.deleteByToken(token);
  }
}
