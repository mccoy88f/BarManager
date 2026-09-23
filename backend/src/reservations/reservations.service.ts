import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Reservation, ReservationStatus, Table } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ReservationsMailService } from './reservations-mail.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { RejectReservationDto } from './dto/reject-reservation.dto';

interface ReservationVenueSettings {
  id: string;
  name: string;
  email: string | null;
  reservationsEnabled: boolean;
  reservationAutoConfirmMaxSeats: number;
  reservationSlotDurationMinutes: number;
  reservationHorizonDays: number;
  lunchStart: string;
  lunchEnd: string;
  dinnerStart: string;
  dinnerEnd: string;
}

const VENUE_SELECT = {
  id: true,
  name: true,
  email: true,
  reservationsEnabled: true,
  reservationAutoConfirmMaxSeats: true,
  reservationSlotDurationMinutes: true,
  reservationHorizonDays: true,
  lunchStart: true,
  lunchEnd: true,
  dinnerStart: true,
  dinnerEnd: true,
} as const;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Disponibilità/assegnazione tavoli (§5.7 di DEVELOPMENT.md).
 *
 * Nota: come già in menu.service.ts, gli orari pranzo/cena sono confrontati
 * con l'ora locale del server (nessuna gestione fuso orario per-locale,
 * rifinitura futura).
 */
@Injectable()
export class ReservationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private mail: ReservationsMailService,
  ) {}

  // ---- Tavoli / disponibilità --------------------------------------------

  private async getVenueSettings(venueId: string): Promise<ReservationVenueSettings> {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: VENUE_SELECT });
    if (!venue) throw new NotFoundException('Locale non trovato');
    return venue;
  }

  /** Valida che l'orario richiesto sia nell'orizzonte prenotabile e in una fascia pranzo/cena. */
  private validateRequestedTime(venue: ReservationVenueSettings, reservedAtIso: string): Date {
    const reservedAt = new Date(reservedAtIso);
    if (Number.isNaN(reservedAt.getTime())) {
      throw new BadRequestException('Data/ora non valida');
    }
    const now = new Date();
    if (reservedAt.getTime() < now.getTime()) {
      throw new BadRequestException('Non è possibile prenotare nel passato');
    }
    const horizonMs = venue.reservationHorizonDays * 24 * 60 * 60 * 1000;
    if (reservedAt.getTime() > now.getTime() + horizonMs) {
      throw new BadRequestException(
        `Non è possibile prenotare oltre ${venue.reservationHorizonDays} giorni da oggi`,
      );
    }
    const minutes = reservedAt.getHours() * 60 + reservedAt.getMinutes();
    const inLunch = minutes >= toMinutes(venue.lunchStart) && minutes <= toMinutes(venue.lunchEnd);
    const inDinner = minutes >= toMinutes(venue.dinnerStart) && minutes <= toMinutes(venue.dinnerEnd);
    if (!inLunch && !inDinner) {
      throw new BadRequestException('Orario fuori dalle fasce di apertura (pranzo/cena)');
    }
    return reservedAt;
  }

  private windowsOverlap(otherStart: Date, slotMinutes: number, windowStart: Date, windowEnd: Date) {
    const otherEnd = new Date(otherStart.getTime() + slotMinutes * 60000);
    return otherStart < windowEnd && otherEnd > windowStart;
  }

  /** Prenotazioni attive (contano per capienza/tavoli occupati) sovrapposte alla finestra data. */
  private async findOverlapping(
    venueId: string,
    reservedAt: Date,
    slotMinutes: number,
    excludeReservationId?: string,
  ): Promise<Reservation[]> {
    const windowStart = reservedAt;
    const windowEnd = new Date(reservedAt.getTime() + slotMinutes * 60000);
    const candidates = await this.prisma.reservation.findMany({
      where: {
        venueId,
        status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
        id: excludeReservationId ? { not: excludeReservationId } : undefined,
      },
    });
    return candidates.filter((r) => this.windowsOverlap(r.reservedAt, slotMinutes, windowStart, windowEnd));
  }

  /** Posti totali (tavoli attivi) e posti già occupati da prenotazioni sovrapposte. */
  async getAvailability(venueId: string, reservedAtIso: string, excludeReservationId?: string) {
    const venue = await this.getVenueSettings(venueId);
    const reservedAt = this.validateRequestedTime(venue, reservedAtIso);
    const tables = await this.prisma.table.findMany({ where: { venueId, active: true } });
    const totalSeats = tables.reduce((sum, t) => sum + t.seats, 0);
    const overlapping = await this.findOverlapping(
      venueId,
      reservedAt,
      venue.reservationSlotDurationMinutes,
      excludeReservationId,
    );
    const occupiedSeats = overlapping.reduce((sum, r) => sum + r.partySize, 0);
    return { totalSeats, occupiedSeats, availableSeats: Math.max(0, totalSeats - occupiedSeats) };
  }

  /**
   * Tavolo libero più piccolo che contiene partySize persone (best-fit):
   * massimizza l'occupazione non "sprecando" un tavolo grande su un
   * gruppo piccolo. Se nessun tavolo singolo basta, v1 non combina tavoli
   * (gestione manuale dell'admin, §10 di DEVELOPMENT.md).
   */
  private async findBestFitTable(
    venueId: string,
    reservedAt: Date,
    slotMinutes: number,
    partySize: number,
    excludeReservationId?: string,
  ): Promise<Table | null> {
    const tables = await this.prisma.table.findMany({
      where: { venueId, active: true },
      orderBy: { seats: 'asc' },
    });
    const overlapping = await this.findOverlapping(venueId, reservedAt, slotMinutes, excludeReservationId);
    const busyTableIds = new Set(overlapping.map((r) => r.tableId).filter((id): id is string => !!id));
    return tables.find((t) => t.seats >= partySize && !busyTableIds.has(t.id)) ?? null;
  }

  // ---- Prenotazione pubblica ----------------------------------------------

  async createPublicReservation(venueId: string, dto: CreateReservationDto) {
    const venue = await this.getVenueSettings(venueId);
    if (!venue.reservationsEnabled) {
      throw new NotFoundException('Prenotazioni non disponibili per questo locale');
    }
    const reservedAt = this.validateRequestedTime(venue, dto.reservedAt);

    const tables = await this.prisma.table.findMany({ where: { venueId, active: true } });
    const totalSeats = tables.reduce((sum, t) => sum + t.seats, 0);
    const overlapping = await this.findOverlapping(venueId, reservedAt, venue.reservationSlotDurationMinutes);
    const occupiedSeats = overlapping.reduce((sum, r) => sum + r.partySize, 0);

    if (occupiedSeats + dto.partySize > totalSeats) {
      const admins = await this.prisma.user.findMany({ where: { venueId, role: 'ADMIN' } });
      await this.prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type: 'RESERVATION_BLOCKED',
          message: `Richiesta di prenotazione bloccata (posti insufficienti): ${dto.firstName} ${dto.lastName}, ${dto.partySize} persone il ${reservedAt.toLocaleString('it-IT')}`,
        })),
      });
      throw new ConflictException(
        'Non ci sono posti disponibili per questo orario. Prova un altro orario o contattaci direttamente.',
      );
    }

    const bestFit = await this.findBestFitTable(
      venueId,
      reservedAt,
      venue.reservationSlotDurationMinutes,
      dto.partySize,
    );
    const autoConfirm = dto.partySize <= venue.reservationAutoConfirmMaxSeats && !!bestFit;
    const status = autoConfirm ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING;

    const reservation = await this.prisma.reservation.create({
      data: {
        venueId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        partySize: dto.partySize,
        reservedAt,
        isEvent: dto.isEvent ?? false,
        eventNote: dto.eventNote,
        allergiesNote: dto.allergiesNote,
        notes: dto.notes,
        status,
        tableId: bestFit?.id ?? null,
      },
      include: { table: true },
    });

    if (status === ReservationStatus.CONFIRMED) {
      await this.mail.sendConfirmed(reservation, venue.name, venue.email);
    } else {
      await this.mail.sendReceived(reservation, venue.name, venue.email);
      const admins = await this.prisma.user.findMany({ where: { venueId, role: 'ADMIN' } });
      await this.prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type: 'RESERVATION_PENDING',
          message: `Nuova prenotazione da confermare: ${dto.firstName} ${dto.lastName}, ${dto.partySize} persone`,
        })),
      });
    }

    return { id: reservation.id, status: reservation.status };
  }

  // ---- Amministrazione -----------------------------------------------------

  listReservations(venueId: string, status?: ReservationStatus) {
    return this.prisma.reservation.findMany({
      where: { venueId, status },
      include: { table: true },
      orderBy: { reservedAt: 'asc' },
    });
  }

  private async requireReservation(venueId: string, reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.venueId !== venueId) {
      throw new NotFoundException('Prenotazione non trovata');
    }
    return reservation;
  }

  private async requireOwnTable(venueId: string, tableId: string) {
    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table || table.venueId !== venueId) {
      throw new NotFoundException('Tavolo non trovato');
    }
    return table;
  }

  async accept(user: AuthenticatedUser, venueId: string, reservationId: string, tableId?: string | null) {
    const before = await this.requireReservation(venueId, reservationId);
    if (before.status !== ReservationStatus.PENDING) {
      throw new BadRequestException('Prenotazione già gestita');
    }
    const finalTableId = tableId !== undefined ? tableId : before.tableId;
    if (finalTableId) await this.requireOwnTable(venueId, finalTableId);

    const venue = await this.getVenueSettings(venueId);
    const after = await this.prisma.reservation.update({
      where: { id: reservationId },
      data: {
        status: ReservationStatus.CONFIRMED,
        tableId: finalTableId,
        respondedById: user.userId,
        respondedAt: new Date(),
      },
      include: { table: true },
    });

    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'Reservation',
      entityId: reservationId,
      action: 'UPDATE',
      before,
      after,
    });
    await this.mail.sendConfirmed(after, venue.name, venue.email);
    return after;
  }

  async reject(user: AuthenticatedUser, venueId: string, reservationId: string, dto: RejectReservationDto) {
    const before = await this.requireReservation(venueId, reservationId);
    if (before.status !== ReservationStatus.PENDING) {
      throw new BadRequestException('Prenotazione già gestita');
    }
    const venue = await this.getVenueSettings(venueId);
    const after = await this.prisma.reservation.update({
      where: { id: reservationId },
      data: {
        status: ReservationStatus.REJECTED,
        rejectionReason: dto.reason,
        respondedById: user.userId,
        respondedAt: new Date(),
      },
      include: { table: true },
    });

    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'Reservation',
      entityId: reservationId,
      action: 'UPDATE',
      before,
      after,
    });
    await this.mail.sendRejected(after, venue.name, dto.reason, venue.email);
    return after;
  }

  /** Cancellazione da parte dell'admin di una prenotazione confermata (es. il cliente disdice per telefono). */
  async cancel(user: AuthenticatedUser, venueId: string, reservationId: string) {
    const before = await this.requireReservation(venueId, reservationId);
    if (before.status !== ReservationStatus.CONFIRMED && before.status !== ReservationStatus.PENDING) {
      throw new BadRequestException('Prenotazione già chiusa');
    }
    const after = await this.prisma.reservation.update({
      where: { id: reservationId },
      data: { status: ReservationStatus.CANCELLED, respondedById: user.userId, respondedAt: new Date() },
      include: { table: true },
    });
    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'Reservation',
      entityId: reservationId,
      action: 'UPDATE',
      before,
      after,
    });
    return after;
  }

  /** Riassegnazione manuale del tavolo, in qualunque momento (anche su una prenotazione già confermata). */
  async reassignTable(venueId: string, reservationId: string, tableId?: string | null) {
    const reservation = await this.requireReservation(venueId, reservationId);
    if (
      reservation.status === ReservationStatus.REJECTED ||
      reservation.status === ReservationStatus.CANCELLED
    ) {
      throw new BadRequestException('Prenotazione chiusa: non è possibile modificare il tavolo');
    }
    if (tableId) await this.requireOwnTable(venueId, tableId);
    return this.prisma.reservation.update({
      where: { id: reservationId },
      data: { tableId: tableId ?? null },
      include: { table: true },
    });
  }
}
