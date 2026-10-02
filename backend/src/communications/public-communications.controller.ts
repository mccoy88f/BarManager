import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { CommunicationsService } from './communications.service';

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
  constructor(private communicationsService: CommunicationsService) {}

  @Get(':recipientId/open')
  async trackOpen(@Param('recipientId') recipientId: string, @Res() res: Response) {
    await this.communicationsService.markOpened(recipientId);
    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': TRANSPARENT_PIXEL_GIF.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.send(TRANSPARENT_PIXEL_GIF);
  }

  @Get(':recipientId/click')
  async trackClick(@Param('recipientId') recipientId: string, @Res() res: Response) {
    const url = await this.communicationsService.markClicked(recipientId);
    res.redirect(url ?? '/');
  }
}
