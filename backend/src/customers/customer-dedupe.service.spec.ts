import { CustomerDedupeService } from './customer-dedupe.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CustomerDedupeService', () => {
  let prisma: {
    customer: { findMany: jest.Mock; update: jest.Mock; deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: CustomerDedupeService;

  beforeEach(() => {
    prisma = {
      customer: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    service = new CustomerDedupeService(prisma as unknown as PrismaService);
  });

  it('non fa nulla se non ci sono duplicati', async () => {
    prisma.customer.findMany.mockResolvedValue([
      { id: 'c1', venueId: 'venue-1', email: 'mario@test.it', createdAt: new Date('2024-01-01') },
      { id: 'c2', venueId: 'venue-1', email: 'altro@test.it', createdAt: new Date('2024-01-02') },
    ]);

    await service.mergeDuplicates();

    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.customer.deleteMany).not.toHaveBeenCalled();
  });

  it('non unisce clienti con la stessa email ma di locali diversi', async () => {
    prisma.customer.findMany.mockResolvedValue([
      { id: 'c1', venueId: 'venue-1', email: 'mario@test.it', createdAt: new Date('2024-01-01') },
      { id: 'c2', venueId: 'venue-2', email: 'Mario@Test.IT', createdAt: new Date('2024-01-02') },
    ]);

    await service.mergeDuplicates();

    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.customer.deleteMany).not.toHaveBeenCalled();
  });

  it('unisce due righe che differiscono solo per maiuscole/minuscole, tenendo la più vecchia come canonica', async () => {
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'c1',
        venueId: 'venue-1',
        email: 'mario@test.it',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        reservationsCount: 2,
        firstReservationAt: new Date('2024-01-01'),
        lastReservationAt: new Date('2024-01-05'),
        marketingConsent: false,
        privacyToken: null,
      },
      {
        id: 'c2',
        venueId: 'venue-1',
        email: 'Mario@Test.IT',
        createdAt: new Date('2024-02-01'),
        updatedAt: new Date('2024-06-01'),
        reservationsCount: 3,
        firstReservationAt: new Date('2023-12-01'),
        lastReservationAt: new Date('2024-06-01'),
        marketingConsent: true,
        privacyToken: 'token-c2',
      },
    ]);

    await service.mergeDuplicates();

    expect(prisma.customer.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['c2'] } } });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        email: 'mario@test.it',
        reservationsCount: 5,
        firstReservationAt: new Date('2023-12-01'),
        lastReservationAt: new Date('2024-06-01'),
        marketingConsent: true, // c2 è la riga aggiornata più di recente
        privacyToken: 'token-c2', // c1 non ne aveva uno, recuperato da c2 prima che venisse eliminata
      },
    });
  });

  it('elimina i doppioni prima di aggiornare la canonica (evita il conflitto sul privacyToken unico)', async () => {
    const callOrder: string[] = [];
    prisma.customer.deleteMany.mockImplementation(() => {
      callOrder.push('delete');
      return Promise.resolve({ count: 1 });
    });
    prisma.customer.update.mockImplementation(() => {
      callOrder.push('update');
      return Promise.resolve({});
    });
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'c1',
        venueId: 'venue-1',
        email: 'mario@test.it',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        reservationsCount: 1,
        firstReservationAt: null,
        lastReservationAt: null,
        marketingConsent: false,
        privacyToken: null,
      },
      {
        id: 'c2',
        venueId: 'venue-1',
        email: 'MARIO@TEST.IT',
        createdAt: new Date('2024-02-01'),
        updatedAt: new Date('2024-02-01'),
        reservationsCount: 1,
        firstReservationAt: null,
        lastReservationAt: null,
        marketingConsent: false,
        privacyToken: 'token-c2',
      },
    ]);

    await service.mergeDuplicates();

    expect(callOrder).toEqual(['delete', 'update']);
  });

  it('non tocca clienti duplicati per errore ma con lo stesso venueId ed email in tutto identiche (già coperti dal vincolo DB)', async () => {
    // Caso limite: se per qualche motivo esistono comunque righe letteralmente
    // identiche (stesso venueId+email), vanno unite lo stesso.
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'c1',
        venueId: 'venue-1',
        email: 'mario@test.it',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        reservationsCount: 1,
        firstReservationAt: new Date('2024-01-01'),
        lastReservationAt: new Date('2024-01-01'),
        marketingConsent: false,
        privacyToken: null,
      },
      {
        id: 'c2',
        venueId: 'venue-1',
        email: 'mario@test.it',
        createdAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-02'),
        reservationsCount: 1,
        firstReservationAt: new Date('2024-01-02'),
        lastReservationAt: new Date('2024-01-02'),
        marketingConsent: false,
        privacyToken: null,
      },
    ]);

    await service.mergeDuplicates();

    expect(prisma.customer.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['c2'] } } });
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ reservationsCount: 2 }) }),
    );
  });
});
