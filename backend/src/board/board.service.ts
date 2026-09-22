import { NotFoundException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { CreateBoardMessageDto } from './dto/create-board-message.dto';

/**
 * Bacheca del locale: messaggi testuali con foto opzionale, che l'admin può
 * pinnare per mostrarli subito in home (gli altri si vedono solo entrando
 * nell'elenco completo).
 */
@Injectable()
export class BoardService {
  constructor(private prisma: PrismaService) {}

  create(user: AuthenticatedUser, dto: CreateBoardMessageDto) {
    return this.prisma.boardMessage.create({
      data: {
        text: dto.text,
        pinned: dto.pinned ?? false,
        venueId: requireVenueId(user),
        createdById: user.userId,
      },
    });
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

  async setPhoto(venueId: string, id: string, photoUrl: string) {
    await this.assertOwnership(venueId, id);
    return this.prisma.boardMessage.update({ where: { id }, data: { photoUrl } });
  }

  async remove(venueId: string, id: string) {
    await this.assertOwnership(venueId, id);
    await this.prisma.boardMessage.delete({ where: { id } });
    return { success: true };
  }
}
