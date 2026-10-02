import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { CommunicationsService } from './communications.service';
import { escapeHtml } from '../common/mail/escape-html';

/** GIF trasparente 1x1, il formato più piccolo per un pixel di tracciamento email. */
const TRANSPARENT_PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

/**
 * Tracciamento apertura/click delle comunicazioni (§1-septdecies di
 * DEVELOPMENT.md): endpoint pubblici, nessun login, identificati solo dal
 * `recipientId` nell'URL (stesso principio del `privacyToken` di
 * PublicCustomersController) — richiamati direttamente dal client di posta
 * del destinatario, non dalla webapp.
 */
@Controller('public/communications')
export class PublicCommunicationsController {
  private readonly logger = new Logger(PublicCommunicationsController.name);

  constructor(private communicationsService: CommunicationsService) {}

  @Get(':recipientId/open')
  async trackOpen(@Param('recipientId') recipientId: string, @Res() res: Response) {
    try {
      await this.communicationsService.markOpened(recipientId);
    } catch (err) {
      // Mai far fallire il pixel per un problema di tracciamento: il client
      // di posta del destinatario non deve vedere un'immagine rotta per un
      // errore che non lo riguarda.
      this.logger.error(`Tracciamento apertura comunicazione ${recipientId} fallito: ${(err as Error).message}`);
    }
    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': TRANSPARENT_PIXEL_GIF.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.send(TRANSPARENT_PIXEL_GIF);
  }

  /**
   * Click sul pulsante CTA: segna il click e reindirizza alla destinazione
   * vera. Oltre all'header Location (302), il corpo della risposta è una
   * pagina HTML minima con <meta refresh> e un link visibile e cliccabile:
   * alcuni client di posta aprono questi link in una webview che non segue
   * sempre un redirect "nudo" senza corpo, lasciando una pagina bianca —
   * con un corpo HTML il destinatario vede comunque qualcosa, e può
   * comunque raggiungere la destinazione a mano se il redirect automatico
   * non scatta. Il tracciamento del click non deve mai bloccare il
   * reindirizzamento: un errore qui viene solo loggato.
   */
  @Get(':recipientId/click')
  async trackClick(@Param('recipientId') recipientId: string, @Res() res: Response) {
    let url: string | null = null;
    try {
      url = await this.communicationsService.markClicked(recipientId);
    } catch (err) {
      this.logger.error(`Tracciamento click comunicazione ${recipientId} fallito: ${(err as Error).message}`);
    }
    const target = url ?? '/';
    res.status(302);
    res.set({
      Location: target,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.send(
      `<!doctype html><html lang="it"><head><meta charset="utf-8" /><meta http-equiv="refresh" content="0;url=${escapeHtml(target)}" /></head><body>Reindirizzamento in corso… Se non succede nulla, <a href="${escapeHtml(target)}">clicca qui</a>.</body></html>`,
    );
  }
}
