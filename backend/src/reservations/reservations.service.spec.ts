import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ReservationStatus } from '@prisma/client';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { ReservationsMailService } from './reservations-mail.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const admin: AuthenticatedUser = {
  userId: 'admin-1',
  email: 'admin@venue1.test',
  role: 'ADMIN',
  venueId: 'venue-1',
};

const baseVenue = {
  id: 'venue-1',
  name: 'Bar Test',
  slug: 'bar-test',
  email: null as string | null,
  reservationsEnabled: true,
  reservationAutoConfirmMaxSeats: 6,
  reservationSlotDurationMinutes: 120,
  reservationHorizonDays: 30,
  reservationOverbookingUnlimited: false,
  reservationOverbookingExtraSeats: 0,
  lunchStart: '12:00',
  lunchEnd: '15:00',
  dinnerStart: '19:00',
  dinnerEnd: '23:00',
};

/** Prossimo orario di cena (entro l'orizzonte), evita di dipendere dall'ora in cui girano i test. */
function nextDinnerSlot(daysAhead = 2): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(20, 0, 0, 0);
  return d;
}

describe('ReservationsService', () => {
  let prisma: {
    venue: { findUnique: jest.Mock };
    table: { findMany: jest.Mock; findUnique: jest.Mock };
    reservation: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      groupBy: jest.Mock;
    };
    user: { findMany: jest.Mock };
    notification: { createMany: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let mail: {
    sendReceived: jest.Mock;
    sendConfirmed: jest.Mock;
    sendRejected: jest.Mock;
    sendCancelled: jest.Mock;
    sendVenueNotification: jest.Mock;
  };
  let service: ReservationsService;

  beforeEach(() => {
    prisma = {
      venue: { findUnique: jest.fn().mockResolvedValue(baseVenue) },
      table: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      reservation: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      notification: { createMany: jest.fn() },
    };
    audit = { log: jest.fn() };
    mail = {
      sendReceived: jest.fn(),
      sendConfirmed: jest.fn(),
      sendRejected: jest.fn(),
      sendCancelled: jest.fn(),
      sendVenueNotification: jest.fn(),
    };
    service = new ReservationsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      mail as unknown as ReservationsMailService,
    );
  });

  describe('getAvailability', () => {
    it('calcola i posti liberi sottraendo le prenotazioni sovrapposte', async () => {
      const reservedAt = nextDinnerSlot();
      prisma.table.findMany.mockResolvedValue([
        { id: 't1', seats: 4, active: true },
        { id: 't2', seats: 6, active: true },
      ]);
      prisma.reservation.findMany.mockResolvedValue([
        { id: 'r1', reservedAt, partySize: 3, tableId: 't1', status: ReservationStatus.CONFIRMED },
      ]);

      const result = await service.getAvailability('venue-1', reservedAt.toISOString());
      expect(result).toEqual({ totalSeats: 10, occupiedSeats: 3, availableSeats: 7 });
    });

    it('ignora le prenotazioni fuori dalla finestra di sovrapposizione', async () => {
      const reservedAt = nextDinnerSlot();
      const farAway = new Date(reservedAt.getTime() + 5 * 60 * 60 * 1000); // 5h dopo, slot da 120min
      prisma.table.findMany.mockResolvedValue([{ id: 't1', seats: 4, active: true }]);
      prisma.reservation.findMany.mockResolvedValue([
        { id: 'r1', reservedAt: farAway, partySize: 4, tableId: 't1', status: ReservationStatus.CONFIRMED },
      ]);

      const result = await service.getAvailability('venue-1', reservedAt.toISOString());
      expect(result.occupiedSeats).toBe(0);
    });

    it('rifiuta un orario fuori dalle fasce pranzo/cena', async () => {
      const badTime = nextDinnerSlot();
      badTime.setHours(17, 0, 0, 0); // fuori pranzo (12-15) e cena (19-23)
      await expect(service.getAvailability('venue-1', badTime.toISOString())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rifiuta una data oltre l\'orizzonte prenotabile', async () => {
      const tooFar = new Date();
      tooFar.setDate(tooFar.getDate() + 60);
      tooFar.setHours(20, 0, 0, 0);
      await expect(service.getAvailability('venue-1', tooFar.toISOString())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('createPublicReservation', () => {
    const dto = {
      firstName: 'Mario',
      lastName: 'Rossi',
      email: 'mario@test.it',
      phone: '3331234567',
      partySize: 4,
      reservedAt: '',
    };

    it('conferma subito se un tavolo adatto è libero e i posti sono sotto la soglia', async () => {
      const reservedAt = nextDinnerSlot();
      prisma.table.findMany.mockResolvedValue([
        { id: 't-small', seats: 4, active: true },
        { id: 't-big', seats: 8, active: true },
      ]);
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      const result = await service.createPublicReservation('venue-1', {
        ...dto,
        reservedAt: reservedAt.toISOString(),
      });

      expect(result.status).toBe(ReservationStatus.CONFIRMED);
      expect(prisma.reservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ReservationStatus.CONFIRMED, tableId: 't-small' }),
        }),
      );
      expect(mail.sendConfirmed).toHaveBeenCalled();
      expect(mail.sendReceived).not.toHaveBeenCalled();
    });

    it('usa il tavolo più piccolo che basta (best-fit), non uno più grande', async () => {
      const reservedAt = nextDinnerSlot();
      // Il vero ordinamento per seats è delegato al DB (orderBy): qui si
      // verifica sia che venga richiesto, sia che la scelta finale sia la
      // più piccola capace di contenere il gruppo.
      prisma.table.findMany.mockResolvedValue([
        { id: 't-4', seats: 4, active: true },
        { id: 't-6', seats: 6, active: true },
        { id: 't-8', seats: 8, active: true },
      ]);
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      await service.createPublicReservation('venue-1', { ...dto, partySize: 4, reservedAt: reservedAt.toISOString() });

      expect(prisma.table.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { seats: 'asc' } }),
      );
      expect(prisma.reservation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tableId: 't-4' }) }),
      );
    });

    it('resta PENDING se sopra la soglia di conferma automatica, anche con tavolo libero', async () => {
      const reservedAt = nextDinnerSlot();
      prisma.table.findMany.mockResolvedValue([{ id: 't-big', seats: 10, active: true }]);
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);

      const result = await service.createPublicReservation('venue-1', {
        ...dto,
        partySize: 8, // sopra la soglia (6)
        reservedAt: reservedAt.toISOString(),
      });

      expect(result.status).toBe(ReservationStatus.PENDING);
      expect(prisma.reservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ReservationStatus.PENDING, tableId: 't-big' }),
        }),
      );
      expect(mail.sendReceived).toHaveBeenCalled();
      expect(prisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ userId: 'admin-1', type: 'RESERVATION_PENDING' })],
        }),
      );
    });

    it('resta PENDING senza tavolo assegnato se nessun singolo tavolo libero basta (v1: niente accorpamenti)', async () => {
      const reservedAt = nextDinnerSlot();
      // Capienza totale sufficiente (2+2=4) ma nessun tavolo singolo da 4.
      prisma.table.findMany.mockResolvedValue([
        { id: 't-a', seats: 2, active: true },
        { id: 't-b', seats: 2, active: true },
      ]);
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      const result = await service.createPublicReservation('venue-1', {
        ...dto,
        partySize: 4,
        reservedAt: reservedAt.toISOString(),
      });

      expect(result.status).toBe(ReservationStatus.PENDING);
      expect(prisma.reservation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tableId: null }) }),
      );
    });

    it('blocca la richiesta e notifica gli admin se supera la capienza totale', async () => {
      const reservedAt = nextDinnerSlot();
      prisma.table.findMany.mockResolvedValue([{ id: 't1', seats: 4, active: true }]);
      prisma.reservation.findMany.mockResolvedValue([
        { id: 'existing', reservedAt, partySize: 2, tableId: 't1', status: ReservationStatus.CONFIRMED },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

      await expect(
        service.createPublicReservation('venue-1', {
          ...dto,
          partySize: 4, // 2 già occupati + 4 > 4 totali
          reservedAt: reservedAt.toISOString(),
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.reservation.create).not.toHaveBeenCalled();
      expect(prisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({ userId: 'admin-1', type: 'RESERVATION_BLOCKED' }),
            expect.objectContaining({ userId: 'admin-2', type: 'RESERVATION_BLOCKED' }),
          ],
        }),
      );
    });

    it('rifiuta se il modulo prenotazioni non è abilitato per il locale', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, reservationsEnabled: false });
      await expect(
        service.createPublicReservation('venue-1', { ...dto, reservedAt: nextDinnerSlot().toISOString() }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('avvisa l\'email del locale con i pulsanti azione se resta PENDING', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, email: 'info@bartest.it' });
      prisma.table.findMany.mockResolvedValue([{ id: 't-big', seats: 10, active: true }]);
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      await service.createPublicReservation('venue-1', {
        ...dto,
        partySize: 8, // sopra soglia auto-confirm -> resta PENDING
        reservedAt: nextDinnerSlot().toISOString(),
      });

      expect(mail.sendVenueNotification).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'res-1' }),
        'Bar Test',
        'info@bartest.it',
        expect.stringContaining('/prenota/gestisci/res-1?token='),
        true,
      );
    });

    it('avvisa l\'email del locale senza pulsanti azione se confermata in automatico', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, email: 'info@bartest.it' });
      prisma.table.findMany.mockResolvedValue([{ id: 't-small', seats: 4, active: true }]);
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      await service.createPublicReservation('venue-1', { ...dto, reservedAt: nextDinnerSlot().toISOString() });

      expect(mail.sendVenueNotification).toHaveBeenCalledWith(
        expect.anything(),
        'Bar Test',
        'info@bartest.it',
        expect.any(String),
        false,
      );
    });

    it('non tenta di avvisare il locale se non ha impostato un\'email', async () => {
      prisma.table.findMany.mockResolvedValue([{ id: 't-small', seats: 4, active: true }]);
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      await service.createPublicReservation('venue-1', { ...dto, reservedAt: nextDinnerSlot().toISOString() });

      expect(mail.sendVenueNotification).not.toHaveBeenCalled();
    });
  });

  describe('accept/reject', () => {
    const pending = {
      id: 'res-1',
      venueId: 'venue-1',
      status: ReservationStatus.PENDING,
      tableId: 'suggested-table',
      firstName: 'Mario',
      email: 'mario@test.it',
      partySize: 4,
      reservedAt: nextDinnerSlot(),
    };

    it('accetta confermando il tavolo suggerito se non viene indicato altro', async () => {
      prisma.reservation.findUnique.mockResolvedValue(pending);
      prisma.table.findUnique.mockResolvedValue({ id: 'suggested-table', venueId: 'venue-1' });
      prisma.reservation.update.mockResolvedValue({ ...pending, status: ReservationStatus.CONFIRMED });

      await service.accept(admin, 'venue-1', 'res-1', undefined);

      expect(prisma.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ReservationStatus.CONFIRMED, tableId: 'suggested-table' }),
        }),
      );
      expect(mail.sendConfirmed).toHaveBeenCalled();
    });

    it('rifiuta con motivo e invia l\'email al cliente', async () => {
      prisma.reservation.findUnique.mockResolvedValue(pending);
      prisma.reservation.update.mockResolvedValue({
        ...pending,
        status: ReservationStatus.REJECTED,
        rejectionReason: 'Tutto esaurito',
      });

      await service.reject(admin, 'venue-1', 'res-1', { reason: 'Tutto esaurito' });

      expect(prisma.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ReservationStatus.REJECTED, rejectionReason: 'Tutto esaurito' }),
        }),
      );
      expect(mail.sendRejected).toHaveBeenCalled();
    });

    it('rifiuta di accettare/rifiutare una prenotazione già gestita', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...pending, status: ReservationStatus.CONFIRMED });
      await expect(service.accept(admin, 'venue-1', 'res-1', undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.reject(admin, 'venue-1', 'res-1', { reason: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rifiuta operazioni su una prenotazione di un altro locale', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...pending, venueId: 'venue-2' });
      await expect(service.accept(admin, 'venue-1', 'res-1', undefined)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cancel', () => {
    it('annulla una prenotazione confermata e avvisa il cliente via email', async () => {
      const confirmed = {
        id: 'res-1',
        venueId: 'venue-1',
        status: ReservationStatus.CONFIRMED,
        firstName: 'Mario',
        email: 'mario@test.it',
        partySize: 4,
        reservedAt: nextDinnerSlot(),
      };
      prisma.reservation.findUnique.mockResolvedValue(confirmed);
      prisma.reservation.update.mockResolvedValue({ ...confirmed, status: ReservationStatus.CANCELLED });

      await service.cancel(admin, 'venue-1', 'res-1');

      expect(prisma.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ReservationStatus.CANCELLED, respondedById: 'admin-1' }),
        }),
      );
      expect(mail.sendCancelled).toHaveBeenCalledWith(
        expect.objectContaining({ status: ReservationStatus.CANCELLED }),
        'Bar Test',
        null,
      );
    });

    it('rifiuta di annullare una prenotazione già rifiutata o già annullata', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: 'res-1',
        venueId: 'venue-1',
        status: ReservationStatus.REJECTED,
      });
      await expect(service.cancel(admin, 'venue-1', 'res-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mail.sendCancelled).not.toHaveBeenCalled();
    });
  });

  describe('gestione via token (link nell\'email al locale)', () => {
    const pending = {
      id: 'res-1',
      venueId: 'venue-1',
      status: ReservationStatus.PENDING,
      tableId: 'suggested-table',
      firstName: 'Mario',
      email: 'mario@test.it',
      partySize: 4,
      reservedAt: nextDinnerSlot(),
      manageToken: 'secret-token',
    };

    it('restituisce la prenotazione e i tavoli attivi se il token combacia', async () => {
      prisma.reservation.findUnique.mockResolvedValue(pending);
      prisma.table.findMany.mockResolvedValue([{ id: 't1', seats: 4, active: true }]);

      const result = await service.getForManage('res-1', 'secret-token');

      expect(result.reservation).toEqual(pending);
      expect(result.tables).toEqual([{ id: 't1', seats: 4, active: true }]);
    });

    it('rifiuta con NotFoundException se il token non combacia', async () => {
      prisma.reservation.findUnique.mockResolvedValue(pending);
      await expect(service.getForManage('res-1', 'wrong-token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('accetta tramite token senza registrare un utente responsabile', async () => {
      prisma.reservation.findUnique.mockResolvedValue(pending);
      prisma.table.findMany.mockResolvedValue([]);
      prisma.table.findUnique.mockResolvedValue({ id: 'suggested-table', venueId: 'venue-1' });
      prisma.reservation.update.mockResolvedValue({ ...pending, status: ReservationStatus.CONFIRMED });

      await service.acceptByToken('res-1', 'secret-token', undefined);

      expect(prisma.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ReservationStatus.CONFIRMED, respondedById: null }),
        }),
      );
      expect(audit.log).not.toHaveBeenCalled();
      expect(mail.sendConfirmed).toHaveBeenCalled();
    });

    it('rifiuta tramite token senza registrare un utente responsabile', async () => {
      prisma.reservation.findUnique.mockResolvedValue(pending);
      prisma.table.findMany.mockResolvedValue([]);
      prisma.reservation.update.mockResolvedValue({ ...pending, status: ReservationStatus.REJECTED });

      await service.rejectByToken('res-1', 'secret-token', 'Tutto esaurito');

      expect(prisma.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReservationStatus.REJECTED,
            rejectionReason: 'Tutto esaurito',
            respondedById: null,
          }),
        }),
      );
      expect(audit.log).not.toHaveBeenCalled();
      expect(mail.sendRejected).toHaveBeenCalled();
    });

    it('rifiuta di gestire due volte la stessa prenotazione via token', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...pending, status: ReservationStatus.CONFIRMED });
      prisma.table.findMany.mockResolvedValue([]);
      await expect(service.acceptByToken('res-1', 'secret-token', undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('tolleranza overbooking configurabile', () => {
    const dto = {
      firstName: 'Mario',
      lastName: 'Rossi',
      email: 'mario@test.it',
      phone: '3331234567',
      partySize: 4,
      reservedAt: '',
    };

    it('accetta di superare la capienza entro la soglia di posti extra', async () => {
      const reservedAt = nextDinnerSlot();
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, reservationOverbookingExtraSeats: 4 });
      prisma.table.findMany.mockResolvedValue([{ id: 't1', seats: 4, active: true }]);
      prisma.reservation.findMany.mockResolvedValue([
        { id: 'existing', reservedAt, partySize: 2, tableId: 't1', status: ReservationStatus.CONFIRMED },
      ]);
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      const result = await service.createPublicReservation('venue-1', {
        ...dto,
        partySize: 4, // 2 già occupati + 4 = 6, sopra i 4 totali ma dentro i +4 di tolleranza
        reservedAt: reservedAt.toISOString(),
      });

      expect(result.status).toBeDefined();
      expect(prisma.reservation.create).toHaveBeenCalled();
    });

    it('blocca comunque se si supera anche la soglia di posti extra', async () => {
      const reservedAt = nextDinnerSlot();
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, reservationOverbookingExtraSeats: 1 });
      prisma.table.findMany.mockResolvedValue([{ id: 't1', seats: 4, active: true }]);
      prisma.reservation.findMany.mockResolvedValue([
        { id: 'existing', reservedAt, partySize: 2, tableId: 't1', status: ReservationStatus.CONFIRMED },
      ]);

      await expect(
        service.createPublicReservation('venue-1', {
          ...dto,
          partySize: 4, // 2 + 4 = 6 > 4 totali + 1 di tolleranza
          reservedAt: reservedAt.toISOString(),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('non blocca mai se l\'overbooking è impostato come illimitato', async () => {
      const reservedAt = nextDinnerSlot();
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, reservationOverbookingUnlimited: true });
      prisma.table.findMany.mockResolvedValue([{ id: 't1', seats: 2, active: true }]);
      prisma.reservation.findMany.mockResolvedValue([
        { id: 'existing', reservedAt, partySize: 2, tableId: 't1', status: ReservationStatus.CONFIRMED },
      ]);
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      const result = await service.createPublicReservation('venue-1', {
        ...dto,
        partySize: 20, // ben oltre la capienza (2 posti totali)
        reservedAt: reservedAt.toISOString(),
      });

      expect(result).toBeDefined();
      expect(prisma.reservation.create).toHaveBeenCalled();
    });
  });

  describe('creazione manuale in backoffice', () => {
    const manualDto = {
      firstName: 'Giulia',
      lastName: 'Bianchi',
      email: 'Giulia.Bianchi@Test.IT',
      phone: '3339876543',
      partySize: 12,
      reservedAt: '2026-01-15T20:00:00.000Z',
    };

    it('crea sempre la prenotazione, anche oltre la capienza e senza tavolo, già CONFIRMED', async () => {
      // Nessuna chiamata a table.findMany/reservation.findMany per il
      // calcolo disponibilità: la creazione manuale non lo esegue affatto.
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      const result = await service.createManualReservation(admin, 'venue-1', manualDto);

      expect(prisma.reservation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReservationStatus.CONFIRMED,
            tableId: null,
            email: 'giulia.bianchi@test.it', // normalizzata in minuscolo
            respondedById: 'admin-1',
          }),
        }),
      );
      expect(audit.log).toHaveBeenCalled();
      expect(mail.sendConfirmed).toHaveBeenCalled();
      expect(result.status).toBe(ReservationStatus.CONFIRMED);
    });

    it('assegna il tavolo indicato se fornito, verificandone la proprietà', async () => {
      prisma.table.findUnique.mockResolvedValue({ id: 'table-1', venueId: 'venue-1' });
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      await service.createManualReservation(admin, 'venue-1', { ...manualDto, tableId: 'table-1' });

      expect(prisma.reservation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tableId: 'table-1' }) }),
      );
    });

    it('rifiuta se il tavolo indicato non appartiene al locale', async () => {
      prisma.table.findUnique.mockResolvedValue({ id: 'table-1', venueId: 'venue-2' });
      await expect(
        service.createManualReservation(admin, 'venue-1', { ...manualDto, tableId: 'table-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.reservation.create).not.toHaveBeenCalled();
    });
  });

  describe('clienti (ricerca e storico)', () => {
    const reservationsByCustomer = [
      {
        id: 'r1',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario@test.it',
        phone: '333111',
        reservedAt: new Date('2026-01-01T20:00:00Z'),
      },
      {
        id: 'r2',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario@test.it',
        phone: '333111',
        reservedAt: new Date('2026-02-01T20:00:00Z'),
      },
    ];

    it('raggruppa i risultati della ricerca per email, con conteggio e ultima prenotazione', async () => {
      prisma.reservation.findMany.mockResolvedValue(reservationsByCustomer);

      const result = await service.searchCustomers('venue-1', 'Mario');

      expect(result).toEqual([
        expect.objectContaining({ email: 'mario@test.it', count: 2 }),
      ]);
    });

    it('non effettua ricerche troppo corte', async () => {
      const result = await service.searchCustomers('venue-1', 'M');
      expect(result).toEqual([]);
      expect(prisma.reservation.findMany).not.toHaveBeenCalled();
    });

    it('restituisce lo storico di un cliente normalizzando l\'email', async () => {
      prisma.reservation.findMany.mockResolvedValue(reservationsByCustomer);
      await service.getCustomerHistory('venue-1', 'Mario@Test.IT');
      expect(prisma.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { venueId: 'venue-1', email: 'mario@test.it' } }),
      );
    });
  });

  describe('listReservations', () => {
    it('marca isReturningCustomer quando la stessa email ha più di una prenotazione', async () => {
      prisma.reservation.findMany.mockResolvedValue([
        { id: 'r1', email: 'mario@test.it', reservedAt: nextDinnerSlot() },
        { id: 'r2', email: 'unica@test.it', reservedAt: nextDinnerSlot() },
      ]);
      prisma.reservation.groupBy.mockResolvedValue([
        { email: 'mario@test.it', _count: { _all: 2 } },
        { email: 'unica@test.it', _count: { _all: 1 } },
      ]);

      const result = await service.listReservations('venue-1');

      expect(result.find((r) => r.id === 'r1')?.isReturningCustomer).toBe(true);
      expect(result.find((r) => r.id === 'r2')?.isReturningCustomer).toBe(false);
    });

    it('con withoutTable=true ignora lo stato e filtra tableId: null', async () => {
      prisma.reservation.findMany.mockResolvedValue([]);
      await service.listReservations('venue-1', ReservationStatus.REJECTED, true);

      expect(prisma.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            venueId: 'venue-1',
            status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
            tableId: null,
          },
        }),
      );
    });
  });
});
