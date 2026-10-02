import { NotFoundException } from '@nestjs/common';
import { BoardService } from './board.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const admin: AuthenticatedUser = {
  userId: 'admin-1',
  email: 'admin@venue1.test',
  role: 'ADMIN',
  venueId: 'venue-1',
};

describe('BoardService', () => {
  let prisma: {
    boardMessage: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    venue: { findUnique: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let mail: { send: jest.Mock };
  let service: BoardService;

  beforeEach(() => {
    prisma = {
      boardMessage: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      venue: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    mail = { send: jest.fn() };
    service = new BoardService(prisma as unknown as PrismaService, mail as unknown as MailService);
  });

  it('crea un messaggio non pinnato di default', async () => {
    prisma.boardMessage.create.mockResolvedValue({ id: 'msg-1', title: 'Avviso', text: 'Ciao a tutti' });
    await service.create(admin, { title: 'Avviso', text: 'Ciao a tutti' });
    expect(prisma.boardMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Avviso',
          text: 'Ciao a tutti',
          pinned: false,
          venueId: 'venue-1',
        }),
      }),
    );
  });

  describe('notifica email ai dipendenti', () => {
    const venue = { name: 'Bar Test', slug: 'bar-test', logoUrl: null };

    beforeEach(() => {
      prisma.boardMessage.create.mockResolvedValue({
        id: 'msg-1',
        title: 'Avviso',
        text: 'Ciao a tutti',
      });
    });

    it('non invia nulla se il locale non viene trovato', async () => {
      prisma.venue.findUnique.mockResolvedValue(null);
      await service.create(admin, { title: 'Avviso', text: 'Ciao a tutti' });
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('non invia nulla se non ci sono altri utenti attivi sul locale', async () => {
      prisma.venue.findUnique.mockResolvedValue(venue);
      prisma.user.findMany.mockResolvedValue([]);
      await service.create(admin, { title: 'Avviso', text: 'Ciao a tutti' });
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('invia un\'email a ciascun utente attivo del locale, escludendo chi ha creato il messaggio', async () => {
      prisma.venue.findUnique.mockResolvedValue(venue);
      prisma.user.findMany.mockResolvedValue([{ email: 'dip1@test.it' }, { email: 'dip2@test.it' }]);
      prisma.boardMessage.create.mockResolvedValue({
        id: 'msg-1',
        title: 'Avviso importante',
        text: 'Ciao a tutti',
      });

      await service.create(admin, { title: 'Avviso importante', text: 'Ciao a tutti' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { venueId: 'venue-1', active: true, id: { not: 'admin-1' } },
        }),
      );
      expect(mail.send).toHaveBeenCalledTimes(2);
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'dip1@test.it',
          subject: expect.stringContaining('Avviso importante'),
          text: expect.stringContaining('Avviso importante'),
          html: expect.stringContaining('Avviso importante'),
        }),
      );
      expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'dip2@test.it' }));
    });
  });

  it('rifiuta pin/eliminazione su un messaggio di un altro locale', async () => {
    prisma.boardMessage.findUnique.mockResolvedValue({ id: 'msg-1', venueId: 'venue-2' });
    await expect(service.setPinned('venue-1', 'msg-1', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove('venue-1', 'msg-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.boardMessage.update).not.toHaveBeenCalled();
    expect(prisma.boardMessage.delete).not.toHaveBeenCalled();
  });

  it('elenca i soli messaggi pinnati con listPinned', async () => {
    prisma.boardMessage.findMany.mockResolvedValue([]);
    await service.listPinned('venue-1');
    expect(prisma.boardMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { venueId: 'venue-1', pinned: true } }),
    );
  });

  it('rimuove la foto di un messaggio impostando photoUrl a null', async () => {
    prisma.boardMessage.findUnique.mockResolvedValue({ id: 'msg-1', venueId: 'venue-1' });
    await service.removePhoto('venue-1', 'msg-1');
    expect(prisma.boardMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { photoUrl: null },
    });
  });
});
