import { NotFoundException } from '@nestjs/common';
import { BoardService } from './board.service';
import { PrismaService } from '../prisma/prisma.service';
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
  };
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
    };
    service = new BoardService(prisma as unknown as PrismaService);
  });

  it('crea un messaggio non pinnato di default', async () => {
    prisma.boardMessage.create.mockResolvedValue({ id: 'msg-1' });
    await service.create(admin, { text: 'Ciao a tutti' });
    expect(prisma.boardMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ text: 'Ciao a tutti', pinned: false, venueId: 'venue-1' }),
      }),
    );
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
});
