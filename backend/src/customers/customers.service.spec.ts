import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';
import { XlsxService } from '../reports/xlsx.service';

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
  let xlsx: { buildSheet: jest.Mock; readSheet: jest.Mock };
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
    xlsx = {
      buildSheet: jest.fn().mockResolvedValue(Buffer.from('fake-xlsx')),
      readSheet: jest.fn().mockResolvedValue([]),
    };
    service = new CustomersService(prisma as unknown as PrismaService, xlsx as unknown as XlsxService);
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
        expect.objectContaining({ data: expect.objectContaining({ email: 'mario@test.it', marketingConsent: false }) }),
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

    it('aggiorna il flag marketingConsent quando passato', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'c1', venueId: 'venue-1' });
      prisma.customer.update.mockResolvedValue({ id: 'c1', marketingConsent: true });

      await service.update('venue-1', 'c1', { marketingConsent: true });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { marketingConsent: true },
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
        marketingConsent: true,
      });

      expect(prisma.customer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { venueId_email: { venueId: 'venue-1', email: 'mario@test.it' } },
          create: expect.objectContaining({
            venueId: 'venue-1',
            email: 'mario@test.it',
            marketingConsent: true,
            reservationsCount: 1,
          }),
          update: expect.objectContaining({
            marketingConsent: true,
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
        marketingConsent: false,
      });

      const { create } = prisma.customer.upsert.mock.calls[0][0];
      expect(create.firstReservationAt).toEqual(create.lastReservationAt);
    });
  });

  describe('exportXlsx', () => {
    it('mappa i clienti nelle colonne attese, YES/NO per il consenso marketing', async () => {
      prisma.customer.findMany.mockResolvedValue([
        {
          id: 'c1',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario@test.it',
          phone: '333',
          marketingConsent: true,
          reservationsCount: 2,
          lastReservationAt: new Date('2026-06-27T20:00:00Z'),
        },
      ]);

      await service.exportXlsx('venue-1');

      const [, , rows] = xlsx.buildSheet.mock.calls[0];
      expect(rows[0]).toEqual(
        expect.objectContaining({
          clientId: 'c1',
          marketingConsent: 'YES',
          reservationsCount: 2,
          lastReservationDate: '2026-06-27',
          lastReservationTime: '20:00',
        }),
      );
    });
  });

  describe('importXlsx', () => {
    it('crea un nuovo cliente generando l\'id quando Client ID è vuoto', async () => {
      xlsx.readSheet.mockResolvedValue([
        {
          'Client ID': null,
          'First name': 'Nicole',
          'Last name': 'Paliotta',
          Email: 'nicole@test.it',
          Phone: '333',
          'Marketing Consent': 'YES',
          'Total Reservation': 1,
          'Last Reservation Date (YYYY-MM-DD)': new Date('2026-01-12T00:00:00Z'),
          'Last Reservation': new Date(Date.UTC(1899, 11, 30, 12, 8)),
        },
      ]);
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue({ id: 'new-id' });

      const result = await service.importXlsx('venue-1', Buffer.from('x'));

      expect(result).toEqual({ created: 1, updated: 0, errors: [] });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            venueId: 'venue-1',
            email: 'nicole@test.it',
            marketingConsent: true,
            reservationsCount: 1,
            lastReservationAt: new Date(Date.UTC(2026, 0, 12, 12, 8)),
          }),
        }),
      );
      expect(prisma.customer.create.mock.calls[0][0].data.id).toBeUndefined();
    });

    it('confronta e aggiorna un cliente esistente trovato per Client ID', async () => {
      xlsx.readSheet.mockResolvedValue([
        {
          'Client ID': 'existing-id',
          'First name': 'Mario',
          'Last name': 'Rossi',
          Email: 'mario@test.it',
          Phone: '999',
          'Marketing Consent': 'NO',
          'Total Reservation': 5,
          'Last Reservation Date (YYYY-MM-DD)': '2026-03-19',
          'Last Reservation': '18:37',
        },
      ]);
      prisma.customer.findUnique.mockResolvedValue({
        id: 'existing-id',
        venueId: 'venue-1',
        firstReservationAt: new Date('2025-01-01T00:00:00Z'),
      });
      prisma.customer.update.mockResolvedValue({ id: 'existing-id' });

      const result = await service.importXlsx('venue-1', Buffer.from('x'));

      expect(result).toEqual({ created: 0, updated: 1, errors: [] });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'existing-id' },
        data: expect.objectContaining({
          phone: '999',
          marketingConsent: false,
          reservationsCount: 5,
          firstReservationAt: new Date('2025-01-01T00:00:00Z'),
        }),
      });
    });

    it('crea con l\'id esplicito indicato se il Client ID non esiste ancora in questo locale', async () => {
      xlsx.readSheet.mockResolvedValue([
        {
          'Client ID': 'external-id-123',
          'First name': 'Carlo',
          'Last name': 'Lancia',
          Email: 'carlo@test.it',
          Phone: '',
          'Marketing Consent': 'NO',
          'Total Reservation': '',
          'Last Reservation Date (YYYY-MM-DD)': '',
          'Last Reservation': '',
        },
      ]);
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue({ id: 'external-id-123' });

      await service.importXlsx('venue-1', Buffer.from('x'));

      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ id: 'external-id-123' }) }),
      );
    });

    it('senza Client ID, aggiorna per email invece di duplicare', async () => {
      xlsx.readSheet.mockResolvedValue([
        {
          'Client ID': null,
          'First name': 'Mario',
          'Last name': 'Rossi',
          Email: 'mario@test.it',
          Phone: '333',
          'Marketing Consent': 'NO',
          'Total Reservation': 3,
          'Last Reservation Date (YYYY-MM-DD)': '',
          'Last Reservation': '',
        },
      ]);
      prisma.customer.findUnique.mockResolvedValueOnce({ id: 'found-by-email', venueId: 'venue-1' });
      prisma.customer.update.mockResolvedValue({ id: 'found-by-email' });

      const result = await service.importXlsx('venue-1', Buffer.from('x'));

      expect(result).toEqual({ created: 0, updated: 1, errors: [] });
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('segnala un errore per riga senza bloccare le altre', async () => {
      xlsx.readSheet.mockResolvedValue([
        { 'Client ID': null, 'First name': '', 'Last name': 'Rossi', Email: 'mario@test.it' },
        {
          'Client ID': null,
          'First name': 'Carlo',
          'Last name': 'Lancia',
          Email: 'carlo@test.it',
          Phone: '333',
          'Marketing Consent': 'NO',
        },
      ]);
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue({ id: 'c2' });

      const result = await service.importXlsx('venue-1', Buffer.from('x'));

      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Riga 2');
    });

    it('rifiuta (con errore) un Client ID che appartiene a un altro locale', async () => {
      xlsx.readSheet.mockResolvedValue([
        {
          'Client ID': 'other-venue-id',
          'First name': 'Mario',
          'Last name': 'Rossi',
          Email: 'mario@test.it',
        },
      ]);
      prisma.customer.findUnique.mockResolvedValue({ id: 'other-venue-id', venueId: 'venue-2' });

      const result = await service.importXlsx('venue-1', Buffer.from('x'));

      expect(result).toEqual({
        created: 0,
        updated: 0,
        errors: [expect.stringContaining('appartiene a un altro locale')],
      });
      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });
  });
});
