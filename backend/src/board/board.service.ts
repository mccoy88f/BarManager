import { NotFoundException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { MailService } from '../common/mail/mail.service';
import { escapeHtml } from '../common/mail/escape-html';
import { venuePublicUrl, venueLogoAbsoluteUrl } from '../common/venue-url/venue-url';
import { CreateBoardMessageDto } from './dto/create-board-message.dto';

/**
 * Bacheca del locale: messaggi testuali con foto opzionale, che l'admin può
 * pinnare per mostrarli subito in home (gli altri si vedono solo entrando
 * nell'elenco completo).
 */
@Injectable()
export class BoardService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateBoardMessageDto) {
    const venueId = requireVenueId(user);
    const message = await this.prisma.boardMessage.create({
      data: {
        title: dto.title,
        text: dto.text,
        pinned: dto.pinned ?? false,
        venueId,
        createdById: user.userId,
      },
    });
    await this.notifyEmployeesByEmail(venueId, user.userId, message.title, message.text);
    return message;
  }

  /**
   * Avvisa via email chiunque abbia un account sul locale (eccetto chi ha
   * appena scritto il messaggio), con un link diretto alla bacheca — stessa
   * logica di `requireVenueId`/isolamento multi-tenant di ogni altro invio,
   * ma qui il destinatario è l'email di login del dipendente stesso, non
   * l'email generica del locale (a differenza, ad es., della notifica admin
   * per le richieste ferie). Un fallimento sui singoli invii non deve far
   * fallire la creazione del messaggio: `MailService.send` non lancia mai,
   * risolve sempre con `{ sent, error }`.
   */
  private async notifyEmployeesByEmail(
    venueId: string,
    excludeUserId: string,
    title: string,
    text: string,
  ) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { name: true, slug: true, logoUrl: true },
    });
    if (!venue) return;

    const recipients = await this.prisma.user.findMany({
      where: { venueId, active: true, id: { not: excludeUserId } },
      select: { email: true },
    });
    if (recipients.length === 0) return;

    const boardUrl = venuePublicUrl(venue, '/board');
    const escapedText = escapeHtml(text).replace(/\n/g, '<br>');

    await Promise.all(
      recipients.map((r) =>
        this.mail.send({
          to: r.email,
          subject: `Nuovo messaggio in bacheca: ${title} — ${venue.name}`,
          text: [
            `È stato pubblicato un nuovo messaggio in bacheca:`,
            '',
            title,
            '',
            text,
            '',
            `Vai alla bacheca: ${boardUrl}`,
          ].join('\n'),
          html: `<div style="font-family:sans-serif;color:#222;">
            <p style="margin-bottom:4px;color:#666;">Nuovo messaggio in bacheca</p>
            <h2 style="margin-top:0;">${escapeHtml(title)}</h2>
            <p>${escapedText}</p>
            <div style="margin-top:16px;">
              <a href="${boardUrl}" style="display:inline-block;background:#1565c0;color:#fff;padding:10px 22px;border-radius:4px;text-decoration:none;font-weight:bold;">Vai alla bacheca</a>
            </div>
          </div>`,
          venueName: venue.name,
          logoUrl: venueLogoAbsoluteUrl(venue),
        }),
      ),
    );
  }

  list(venueId: string) {
    return this.prisma.boardMessage.findMany({
      where: { venueId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  listPinned(venueId: string) {
    return this.prisma.boardMessage.findMany({
      where: { venueId, pinned: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertOwnership(venueId: string, id: string) {
    const message = await this.prisma.boardMessage.findUnique({ where: { id } });
    if (!message || message.venueId !== venueId) {
      throw new NotFoundException('Messaggio non trovato');
    }
    return message;
  }

  async setPinned(venueId: string, id: string, pinned: boolean) {
    await this.assertOwnership(venueId, id);
    return this.prisma.boardMessage.update({ where: { id }, data: { pinned } });
  }

  async updateMessage(venueId: string, id: string, data: { title: string; text: string }) {
    await this.assertOwnership(venueId, id);
    return this.prisma.boardMessage.update({ where: { id }, data });
  }

  async setPhoto(venueId: string, id: string, photoUrl: string) {
    await this.assertOwnership(venueId, id);
    return this.prisma.boardMessage.update({ where: { id }, data: { photoUrl } });
  }

  async removePhoto(venueId: string, id: string) {
    await this.assertOwnership(venueId, id);
    return this.prisma.boardMessage.update({ where: { id }, data: { photoUrl: null } });
  }

  async remove(venueId: string, id: string) {
    await this.assertOwnership(venueId, id);
    await this.prisma.boardMessage.delete({ where: { id } });
    return { success: true };
  }
}
