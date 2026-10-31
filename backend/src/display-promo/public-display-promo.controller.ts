import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { DisplayPromoService } from './display-promo.service';
import { RegisterKioskDto } from './dto/register-kiosk.dto';

/**
 * Endpoint pubblici di Display Promo (nessuna autenticazione richiesta):
 * sia per i browser che visualizzano /display/:screenId, sia per l'app nativa
 * "BarManager Kiosk" installata su TV box / tablet Android che richiede il
 * codice di abbinamento e il relativo stato.
 */
@Controller('public/display-promo')
export class PublicDisplayPromoController {
  constructor(private displayPromoService: DisplayPromoService) {}

  // ---- Endpoint per l'app nativa "BarManager Kiosk" ----------------------

  /** Registrazione iniziale o richiesta codice all'avvio dell'app Android. */
  @Post('kiosk/register')
  registerKiosk(@Body() dto: RegisterKioskDto, @Ip() ipAddress: string) {
    return this.displayPromoService.registerKioskDevice({
      deviceId: dto.deviceId,
      deviceInfo: dto.deviceInfo,
      appVersion: dto.appVersion,
      code: dto.code,
      ipAddress,
    });
  }

  /** Polling dello stato abbinamento durante la schermata iniziale col codice. */
  @Get('kiosk/status')
  getKioskStatus(
    @Query('code') code?: string,
    @Query('deviceId') deviceId?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.displayPromoService.getKioskStatus({ code, deviceId, ipAddress });
  }

  /** Heartbeat periodico dall'app per monitorare lo stato di connessione e rilevare eventuale scollegamento. */
  @Post('kiosk/heartbeat')
  kioskHeartbeat(
    @Body() body: { code?: string; deviceId?: string },
    @Query('code') queryCode?: string,
    @Query('deviceId') queryDeviceId?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.displayPromoService.kioskHeartbeat({
      code: body?.code || queryCode,
      deviceId: body?.deviceId || queryDeviceId,
      ipAddress,
    });
  }

  /** Scollegamento manuale avviato dal dispositivo Kiosk. */
  @Post('kiosk/unpair')
  kioskUnpair(
    @Body() body: { code?: string; deviceId?: string },
    @Query('code') queryCode?: string,
    @Query('deviceId') queryDeviceId?: string,
  ) {
    return this.displayPromoService.kioskUnpairSelf({
      code: body?.code || queryCode,
      deviceId: body?.deviceId || queryDeviceId,
    });
  }

  // ---- Schermi pubblici /display/:screenId -------------------------------

  @Get(':screenId')
  get(@Param('screenId') screenId: string) {
    return this.displayPromoService.getActivePlaylist(screenId);
  }

  /** Separato da sopra: un feed RSS impiega secondi a volte, non deve bloccare il caricamento della playlist. */
  @Get(':screenId/news')
  async getNews(@Param('screenId') screenId: string) {
    return { headlines: await this.displayPromoService.getNewsHeadlines(screenId) };
  }
}

