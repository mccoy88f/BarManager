import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CustomersService', () => {
  let prisma: {
    customer: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: CustomersService;

  beforeEach(() => {
    prisma = {
      customer: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new CustomersService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('normalizza l\'email e crea il cliente', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue({ id: 'c1' });

      await service.create('venue-1', {
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'Mario@Test.IT',
        phone: '333',
      });

      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'mario@test.it' }) }),
      );
    });

    it('rifiuta se esiste già un cliente con la stessa email nel locale', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create('venue-1', { firstName: 'Mario', lastName: 'Rossi', email: 'mario@test.it' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });
  });

  describe('update/remove', () => {
    it('rifiuta se il cliente non esiste o è di un altro locale', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'c1', venueId: 'venue-2' });
      await expect(service.update('venue-1', 'c1', { firstName: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.remove('venue-1', 'c1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('aggiorna solo i campi passati', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'c1', venueId: 'venue-1' });
      prisma.customer.update.mockResolvedValue({ id: 'c1', notes: 'VIP' });

      await service.update('venue-1', 'c1', { notes: 'VIP' });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { notes: 'VIP' },
      });
    });
  });

  describe('recordReservation', () => {
    it('crea il cliente alla prima prenotazione con reservationsCount=1', async () => {
      await service.recordReservation('venue-1', {
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'Mario@Test.IT',
        phone: '333',
      });

      expect(prisma.customer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { venueId_email: { venueId: 'venue-1', email: 'mario@test.it' } },
          create: expect.objectContaining({
            venueId: 'venue-1',
            email: 'mario@test.it',
            reservationsCount: 1,
          }),
          update: expect.objectContaining({
            reservationsCount: { increment: 1 },
          }),
        }),
      );
    });

    it('imposta firstReservationAt e lastReservationAt uguali alla creazione', async () => {
      await service.recordReservation('venue-1', {
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario@test.it',
        phone: '333',
      });

      const { create } = prisma.customer.upsert.mock.calls[0][0];
      expect(create.firstReservationAt).toEqual(create.lastReservationAt);
    });
  });
});
