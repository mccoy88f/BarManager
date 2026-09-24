import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Reservation, ReservationStatus, Table } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { findOpenSlot, resolveOpeningHours } from '../common/opening-hours/opening-hours';
import { jsWeekdayInZone, minutesOfDayInZone } from '../common/timezone/timezone';
import { venueLogoAbsoluteUrl, venuePublicUrl } from '../common/venue-url/venue-url';
import { ReservationsMailService } from './reservations-mail.service';
import { CustomersService } from '../customers/customers.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { CreateManualReservationDto } from './dto/create-manual-reservation.dto';
import { RejectReservationDto } from './dto/reject-reservation.dto';
import { ProposeTimeChangeDto } from './dto/propose-time-change.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { SelfUpdateReservationDto } from './dto/self-update-reservation.dto';

interface ReservationVenueSettings {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  menuPhone: string | null;
  logoUrl: string | null;
  reservationsEnabled: boolean;
  reservationAutoConfirmMaxSeats: number;
  reservationSlotDurationMinutes: number;
  reservationHorizonDays: number;
  reservationOverbookingUnlimited: boolean;
  reservationOverbookingExtraSeats: number;
  reservationMinLeadMinutes: number;
  openingHours: unknown;
  timezone: string;
}

const VENUE_SELECT = {
  id: true,
  name: true,
  slug: true,
  email: true,
  menuPhone: true,
  logoUrl: true,
  reservationsEnabled: true,
  reservationAutoConfirmMaxSeats: true,
  reservationSlotDurationMinutes: true,
  reservationHorizonDays: true,
  reservationOverbookingUnlimited: true,
  reservationOverbookingExtraSeats: true,
  reservationMinLeadMinutes: true,
  openingHours: true,
  timezone: true,
} as const;

/** Finestra di auto-gestione (§10 di DEVELOPMENT.md): il cliente può modificare/annullare da sé la propria richiesta entro questi minuti dalla creazione, dopo deve contattare il locale direttamente. */
const SELF_EDIT_WINDOW_MINUTES = 15;

/** "1 ora e 30 minuti" / "45 minuti" / "2 ore", per il messaggio di errore dell'anticipo minimo. */
function formatLeadMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'ora' : 'ore'}`);
  if (minutes > 0) parts.push(`${minutes} minuti`);
  return parts.join(' e ');
}

/** Include standard per portare i tavoli assegnati (relazione molti-a-molti) dentro ogni prenotazione. */
const TABLES_INCLUDE = { tables: { include: { table: true } } } as const;

type ReservationWithTables = Reservation & { tables: { table: Table }[] };

/**
 * Appiattisce la relazione molti-a-molti `tables` (righe `ReservationTable`
 * con dentro il `Table` completo) in un semplice `tables: Table[]` +
 * `tableIds: string[]`, comodo sia per il frontend che per la logica di
 * disponibilità qui sotto. Una prenotazione può avere più di un tavolo
 * (gruppo grande accostato manualmente dall'admin, §10 di DEVELOPMENT.md).
 */
function flattenTables<T extends { tables: { table: Table }[] }>(
  reservation: T,
): Omit<T, 'tables'> & { tables: Table[]; tableIds: string[] } {
  const tables = reservation.tables.map((rt) => rt.table);
  return { ...reservation, tables, tableIds: tables.map((t) => t.id) };
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
    private customers: CustomersService,
  ) {}

  // ---- Tavoli / disponibilità --------------------------------------------

  private async getVenueSettings(venueId: string): Promise<ReservationVenueSettings> {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: VENUE_SELECT });
    if (!venue) throw new NotFoundException('Locale non trovato');
    return venue;
  }

  /**
   * Valida che l'orario richiesto sia nell'orizzonte prenotabile, ai 15
   * minuti (non al singolo minuto: es. 20:00/20:15/20:30, non 20:07) e
   * dentro una fascia di apertura del locale per quel giorno della
   * settimana (§5.4/§5.7 di DEVELOPMENT.md). `enforceMinLead` applica
   * anche il vincolo di anticipo minimo (`Venue.reservationMinLeadMinutes`,
   * §10): passato solo dal widget pubblico, non dalle chiamate di solo
   * calcolo disponibilità (che altrimenti smetterebbero di funzionare per
   * un orario ormai troppo vicino, anche se non si sta creando nulla).
   */
  private validateRequestedTime(
    venue: ReservationVenueSettings,
    reservedAtIso: string,
    enforceMinLead = false,
  ): Date {
    const reservedAt = new Date(reservedAtIso);
    if (Number.isNaN(reservedAt.getTime())) {
      throw new BadRequestException('Data/ora non valida');
    }
    const now = new Date();
    if (reservedAt.getTime() < now.getTime()) {
      throw new BadRequestException('Non è possibile prenotare nel passato');
    }
    if (enforceMinLead && venue.reservationMinLeadMinutes > 0) {
      const leadMs = venue.reservationMinLeadMinutes * 60 * 1000;
      if (reservedAt.getTime() < now.getTime() + leadMs) {
        throw new BadRequestException(
          `È possibile prenotare solo con almeno ${formatLeadMinutes(venue.reservationMinLeadMinutes)} di anticipo`,
        );
      }
    }
    const horizonMs = venue.reservationHorizonDays * 24 * 60 * 60 * 1000;
    if (reservedAt.getTime() > now.getTime() + horizonMs) {
      throw new BadRequestException(
        `Non è possibile prenotare oltre ${venue.reservationHorizonDays} giorni da oggi`,
      );
    }
    const minutesOfDay = minutesOfDayInZone(reservedAt, venue.timezone);
    if (minutesOfDay % 15 !== 0) {
      throw new BadRequestException(
        "L'orario deve essere ai 15 minuti (es. 20:00, 20:15, 20:30, 20:45)",
      );
    }
    const schedule = resolveOpeningHours(venue.openingHours);
    const day = schedule.find((d) => d.dayOfWeek === jsWeekdayInZone(reservedAt, venue.timezone))!;
    if (findOpenSlot(day, minutesOfDay) === null) {
      throw new BadRequestException(
        day.closed
          ? 'Il locale è chiuso in questo giorno della settimana'
          : 'Orario fuori dagli orari di apertura per questo giorno',
      );
    }
    return reservedAt;
  }

  private windowsOverlap(otherStart: Date, otherDurationMinutes: number, windowStart: Date, windowEnd: Date) {
    const otherEnd = new Date(otherStart.getTime() + otherDurationMinutes * 60000);
    return otherStart < windowEnd && otherEnd > windowStart;
  }

  /** Durata effettiva di una prenotazione: quella scelta per lei, altrimenti il default del locale. */
  private effectiveDuration(
    reservation: { slotDurationMinutes: number | null },
    defaultDurationMinutes: number,
  ): number {
    return reservation.slotDurationMinutes ?? defaultDurationMinutes;
  }

  /**
   * Prenotazioni attive (contano per capienza/tavoli occupati) sovrapposte
   * alla finestra data, coi tavoli assegnati a ciascuna. Ogni candidata usa
   * la PROPRIA durata (impostata per quella singola prenotazione dall'admin,
   * altrimenti il default del locale) — non quella della finestra che si
   * sta controllando: due prenotazioni con durate diverse possono
   * sovrapporsi solo in parte.
   */
  private async findOverlapping(
    venueId: string,
    reservedAt: Date,
    targetDurationMinutes: number,
    defaultDurationMinutes: number,
    excludeReservationId?: string,
  ): Promise<(Reservation & { tables: { tableId: string }[] })[]> {
    const windowStart = reservedAt;
    const windowEnd = new Date(reservedAt.getTime() + targetDurationMinutes * 60000);
    const candidates = await this.prisma.reservation.findMany({
      where: {
        venueId,
        status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
        id: excludeReservationId ? { not: excludeReservationId } : undefined,
      },
      include: { tables: { select: { tableId: true } } },
    });
    return candidates.filter((r) =>
      this.windowsOverlap(r.reservedAt, this.effectiveDuration(r, defaultDurationMinutes), windowStart, windowEnd),
    );
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
      venue.reservationSlotDurationMinutes,
      excludeReservationId,
    );
    const occupiedSeats = overlapping.reduce((sum, r) => sum + r.partySize, 0);
    return { totalSeats, occupiedSeats, availableSeats: Math.max(0, totalSeats - occupiedSeats) };
  }

  /** Id dei tavoli attivi occupati (da altre prenotazioni, su TUTTI i tavoli che occupano) nella finestra data. */
  private async getBusyTableIds(
    venueId: string,
    reservedAt: Date,
    targetDurationMinutes: number,
    defaultDurationMinutes: number,
    excludeReservationId?: string,
  ): Promise<Set<string>> {
    const overlapping = await this.findOverlapping(
      venueId,
      reservedAt,
      targetDurationMinutes,
      defaultDurationMinutes,
      excludeReservationId,
    );
    return new Set(overlapping.flatMap((r) => r.tables.map((t) => t.tableId)));
  }

  /**
   * Blocco vero (non solo segnalazione): impedisce di assegnare a una
   * prenotazione uno o più tavoli già occupati da un'altra prenotazione
   * attiva nella stessa finestra oraria. Usato ovunque un admin scelga i
   * tavoli per una prenotazione (accetta, riassegna, aggiunta manuale) — a
   * differenza del blocco per capienza totale del widget pubblico, questo
   * si applica sempre, anche in backoffice: due prenotazioni non possono
   * mai condividere lo stesso tavolo nello stesso momento.
   */
  private async ensureTablesAvailable(
    venueId: string,
    tableIds: string[],
    reservedAt: Date,
    durationMinutes: number,
    defaultDurationMinutes: number,
    excludeReservationId?: string,
  ) {
    if (tableIds.length === 0) return;
    const busyTableIds = await this.getBusyTableIds(
      venueId,
      reservedAt,
      durationMinutes,
      defaultDurationMinutes,
      excludeReservationId,
    );
    if (tableIds.some((id) => busyTableIds.has(id))) {
      throw new ConflictException(
        "Uno o più tavoli scelti sono già occupati in questo orario da un'altra prenotazione",
      );
    }
  }

  /**
   * Tavolo libero più piccolo che contiene partySize persone (best-fit):
   * massimizza l'occupazione non "sprecando" un tavolo grande su un
   * gruppo piccolo. Se nessun tavolo singolo basta, l'assegnazione
   * automatica (solo per il widget pubblico) non combina tavoli: resta
   * manuale per l'admin, che può farlo scegliendone più di uno (§10 di
   * DEVELOPMENT.md).
   */
  private async findBestFitTable(
    venueId: string,
    reservedAt: Date,
    targetDurationMinutes: number,
    defaultDurationMinutes: number,
    partySize: number,
    excludeReservationId?: string,
  ): Promise<Table | null> {
    const tables = await this.prisma.table.findMany({
      where: { venueId, active: true },
      orderBy: { seats: 'asc' },
    });
    const busyTableIds = await this.getBusyTableIds(
      venueId,
      reservedAt,
      targetDurationMinutes,
      defaultDurationMinutes,
      excludeReservationId,
    );
    return tables.find((t) => t.seats >= partySize && !busyTableIds.has(t.id)) ?? null;
  }

  /** Base + path di una pagina pubblica del locale (nessun login): v. common/venue-url/venue-url.ts, condiviso anche da altri moduli (es. ordini). */
  private buildPublicUrl(venue: ReservationVenueSettings, path: string): string {
    return venuePublicUrl(venue, path);
  }

  /** URL della pagina di gestione dello staff (accetta/rifiuta senza login, §5.7), mandata all'email del locale. */
  private buildManageUrl(venue: ReservationVenueSettings, reservationId: string, token: string): string {
    return this.buildPublicUrl(venue, `/prenota/gestisci/${reservationId}?token=${token}`);
  }

  /** URL della pagina di auto-gestione del cliente (modifica/annulla senza login, entro SELF_EDIT_WINDOW_MINUTES), mandata all'email del cliente. */
  private buildSelfManageUrl(venue: ReservationVenueSettings, reservationId: string, token: string): string {
    return this.buildPublicUrl(venue, `/prenota/modifica/${reservationId}?token=${token}`);
  }

  /** URL della pagina pubblica "gestisci i tuoi dati personali" (§5.8), in fondo alle email al cliente — null se il cliente non ha ancora un token (non dovrebbe succedere, v. CustomersService.ensurePrivacyToken). */
  private buildPrivacyUrl(venue: ReservationVenueSettings, privacyToken: string | null): string | null {
    return privacyToken ? this.buildPublicUrl(venue, `/privacy?token=${privacyToken}`) : null;
  }

  /** URL assoluto del logo del locale (Impostazioni locale), per l'intestazione delle email. */
  private venueLogoUrl(venue: ReservationVenueSettings): string | null {
    return venueLogoAbsoluteUrl(venue);
  }

  /** Termine ultimo per l'auto-gestione: SELF_EDIT_WINDOW_MINUTES dalla creazione della richiesta (non dall'orario prenotato). */
  private selfEditDeadline(reservation: { createdAt: Date }): Date {
    return new Date(reservation.createdAt.getTime() + SELF_EDIT_WINDOW_MINUTES * 60000);
  }

  private canSelfEdit(reservation: { createdAt: Date; status: ReservationStatus }): boolean {
    if (reservation.status === ReservationStatus.REJECTED || reservation.status === ReservationStatus.CANCELLED) {
      return false;
    }
    return new Date() < this.selfEditDeadline(reservation);
  }

  /** Trova la prenotazione dal suo manageToken, senza vincolo di venueId (pagine pubbliche senza login). */
  private async requireByToken(reservationId: string, token: string): Promise<Reservation> {
    const reservation = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.manageToken !== token) {
      throw new NotFoundException('Prenotazione non trovata');
    }
    return reservation;
  }

  // ---- Prenotazione pubblica ----------------------------------------------

  async createPublicReservation(venueId: string, dto: CreateReservationDto) {
    const venue = await this.getVenueSettings(venueId);
    if (!venue.reservationsEnabled) {
      throw new NotFoundException('Prenotazioni non disponibili per questo locale');
    }
    // Obbligatoria solo qui (widget pubblico), non per l'aggiunta manuale
    // dello staff: senza questa autorizzazione non è possibile completare
    // la prenotazione (§10 di DEVELOPMENT.md).
    if (dto.privacyPolicyConsent !== true) {
      throw new BadRequestException(
        'Devi autorizzare il trattamento dei dati personali per completare la prenotazione.',
      );
    }
    const reservedAt = this.validateRequestedTime(venue, dto.reservedAt, true);

    const tables = await this.prisma.table.findMany({ where: { venueId, active: true } });
    const totalSeats = tables.reduce((sum, t) => sum + t.seats, 0);
    const overlapping = await this.findOverlapping(
      venueId,
      reservedAt,
      venue.reservationSlotDurationMinutes,
      venue.reservationSlotDurationMinutes,
    );
    const occupiedSeats = overlapping.reduce((sum, r) => sum + r.partySize, 0);

    // Tolleranza di overbooking configurabile in Impostazioni prenotazioni
    // (§10 di DEVELOPMENT.md): "unlimited" disattiva del tutto il blocco,
    // altrimenti si accetta di superare la capienza fino a extraSeats posti.
    const capacityWithTolerance = totalSeats + venue.reservationOverbookingExtraSeats;
    const exceedsCapacity =
      !venue.reservationOverbookingUnlimited && occupiedSeats + dto.partySize > capacityWithTolerance;

    if (exceedsCapacity) {
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
      venue.reservationSlotDurationMinutes,
      dto.partySize,
    );
    const autoConfirm = dto.partySize <= venue.reservationAutoConfirmMaxSeats && !!bestFit;
    const status = autoConfirm ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING;

    const reservation = flattenTables(
      await this.prisma.reservation.create({
        data: {
          venueId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email.trim().toLowerCase(),
          phone: dto.phone,
          partySize: dto.partySize,
          reservedAt,
          isEvent: dto.isEvent ?? false,
          eventNote: dto.eventNote,
          allergiesNote: dto.allergiesNote,
          notes: dto.notes,
          marketingConsent: dto.marketingConsent ?? false,
          privacyPolicyConsent: true,
          status,
          tables: bestFit ? { create: [{ tableId: bestFit.id }] } : undefined,
          manageToken: randomUUID(),
        },
        include: TABLES_INCLUDE,
      }),
    );

    const customer = await this.customers.recordReservation(venueId, {
      firstName: reservation.firstName,
      lastName: reservation.lastName,
      email: reservation.email,
      phone: reservation.phone,
      marketingConsent: reservation.marketingConsent,
    });

    const selfManageUrl = this.buildSelfManageUrl(venue, reservation.id, reservation.manageToken);
    const privacyUrl = this.buildPrivacyUrl(venue, customer.privacyToken);
    const logoUrl = this.venueLogoUrl(venue);
    if (status === ReservationStatus.CONFIRMED) {
      await this.mail.sendConfirmed(reservation, venue.name, venue.email, selfManageUrl, venue.menuPhone, privacyUrl, logoUrl);
    } else {
      await this.mail.sendReceived(reservation, venue.name, venue.email, selfManageUrl, venue.menuPhone, privacyUrl, logoUrl);
      const admins = await this.prisma.user.findMany({ where: { venueId, role: 'ADMIN' } });
      await this.prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type: 'RESERVATION_PENDING',
          message: `Nuova prenotazione da confermare: ${dto.firstName} ${dto.lastName}, ${dto.partySize} persone`,
        })),
      });
    }

    // Ogni prenotazione avvisa anche l'email del locale (Impostazioni
    // locale), con i pulsanti Accetta/Rifiuta se serve conferma manuale:
    // un canale in più, indipendente dal login, rispetto alla sola
    // Notification in-app già creata sopra per le richieste PENDING.
    if (venue.email) {
      const manageUrl = this.buildManageUrl(venue, reservation.id, reservation.manageToken);
      await this.mail.sendVenueNotification(
        reservation,
        venue.name,
        venue.email,
        manageUrl,
        status === ReservationStatus.PENDING,
        logoUrl,
      );
    }

    return { id: reservation.id, status: reservation.status };
  }

  // ---- Amministrazione -----------------------------------------------------

  /**
   * `status` può essere un singolo stato o un elenco (usato in UI per
   * mostrare rifiutate e annullate nella stessa scheda, senza divisioni,
   * §10 di DEVELOPMENT.md). `withoutTable`: ignora `status` e restituisce,
   * indipendentemente dallo stato, tutte le prenotazioni attive (PENDING/
   * CONFIRMED) senza nemmeno un tavolo assegnato — la "coda prenotazioni"
   * da assegnare, che raccoglie sia le richieste online rimaste manuali
   * sia quelle aggiunte a mano in backoffice senza scegliere un tavolo.
   *
   * Ogni riga porta anche `isReturningCustomer`: true se la stessa email
   * ha più di una prenotazione presso questo locale, per mostrare in UI il
   * pulsante "storico cliente".
   */
  async listReservations(
    venueId: string,
    status?: ReservationStatus | ReservationStatus[],
    withoutTable?: boolean,
  ) {
    const statusFilter = withoutTable
      ? { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] }
      : Array.isArray(status)
        ? { in: status }
        : status;
    const reservations = await this.prisma.reservation.findMany({
      where: {
        venueId,
        status: statusFilter,
        tables: withoutTable ? { none: {} } : undefined,
      },
      include: TABLES_INCLUDE,
      orderBy: { reservedAt: 'asc' },
    });

    const emails = [...new Set(reservations.map((r) => r.email))];
    const counts =
      emails.length === 0
        ? []
        : await this.prisma.reservation.groupBy({
            by: ['email'],
            where: { venueId, email: { in: emails } },
            _count: { _all: true },
          });
    const countByEmail = new Map(counts.map((c) => [c.email, c._count._all]));

    // Tavoli occupati per ciascuna riga, alla SUA finestra oraria (non a
    // quella delle altre): due chiamate qui invece che una per riga,
    // l'overlap fra ciascuna coppia si calcola poi in memoria.
    const venue = await this.getVenueSettings(venueId);
    const activeWithTable = await this.prisma.reservation.findMany({
      where: {
        venueId,
        status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
        tables: { some: {} },
      },
      include: { tables: { select: { tableId: true } } },
    });

    return reservations.map((r) => {
      const windowStart = r.reservedAt;
      const windowEnd = new Date(
        windowStart.getTime() + this.effectiveDuration(r, venue.reservationSlotDurationMinutes) * 60000,
      );
      const busyTableIds = activeWithTable
        .filter((other) => other.id !== r.id)
        .filter((other) =>
          this.windowsOverlap(
            other.reservedAt,
            this.effectiveDuration(other, venue.reservationSlotDurationMinutes),
            windowStart,
            windowEnd,
          ),
        )
        .flatMap((other) => other.tables.map((t) => t.tableId));
      return {
        ...flattenTables(r),
        isReturningCustomer: (countByEmail.get(r.email) ?? 1) > 1,
        busyTableIds,
      };
    });
  }

  /** Tavoli attivi liberi per un dato orario/durata (quelli occupati da un'altra prenotazione attiva non compaiono) — per il dialog di aggiunta manuale, prima ancora che la prenotazione esista. */
  async getTableAvailability(venueId: string, reservedAtIso: string, durationMinutes?: number) {
    const venue = await this.getVenueSettings(venueId);
    const reservedAt = new Date(reservedAtIso);
    if (Number.isNaN(reservedAt.getTime())) {
      throw new BadRequestException('Data/ora non valida');
    }
    const targetDuration = durationMinutes ?? venue.reservationSlotDurationMinutes;
    const tables = await this.prisma.table.findMany({
      where: { venueId, active: true },
      orderBy: { seats: 'asc' },
    });
    const busyTableIds = await this.getBusyTableIds(
      venueId,
      reservedAt,
      targetDuration,
      venue.reservationSlotDurationMinutes,
    );
    return tables.filter((t) => !busyTableIds.has(t.id));
  }

  /**
   * Clienti già prenotati che combaciano con la ricerca (nome, cognome,
   * email o telefono): usato per "pescare" i dati di un cliente esistente
   * quando si aggiunge una prenotazione a mano in backoffice. Un cliente è
   * qui solo una email distinta fra le prenotazioni passate — non esiste
   * un'anagrafica clienti separata (v1).
   */
  async searchCustomers(venueId: string, query: string) {
    const q = query?.trim();
    if (!q || q.length < 2) return [];

    const matches = await this.prisma.reservation.findMany({
      where: {
        venueId,
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { reservedAt: 'desc' },
      take: 200,
    });

    const byEmail = new Map<
      string,
      { firstName: string; lastName: string; email: string; phone: string; count: number; lastReservedAt: Date }
    >();
    for (const r of matches) {
      const existing = byEmail.get(r.email);
      if (existing) {
        existing.count += 1;
        if (r.reservedAt > existing.lastReservedAt) {
          existing.lastReservedAt = r.reservedAt;
          existing.firstName = r.firstName;
          existing.lastName = r.lastName;
          existing.phone = r.phone;
        }
      } else {
        byEmail.set(r.email, {
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email,
          phone: r.phone,
          count: 1,
          lastReservedAt: r.reservedAt,
        });
      }
    }

    return [...byEmail.values()]
      .sort((a, b) => b.lastReservedAt.getTime() - a.lastReservedAt.getTime())
      .slice(0, 10);
  }

  /** Storico completo di un cliente (per email), per il pulsante "storico cliente". */
  async getCustomerHistory(venueId: string, email: string) {
    const reservations = await this.prisma.reservation.findMany({
      where: { venueId, email: email.trim().toLowerCase() },
      include: TABLES_INCLUDE,
      orderBy: { reservedAt: 'desc' },
    });
    return reservations.map(flattenTables);
  }

  /**
   * Prenotazione aggiunta a mano dallo staff (telefono, di persona, ecc.):
   * a differenza di createPublicReservation, non applica il calcolo di
   * disponibilità/capienza totale né il blocco overbooking — lo staff può
   * sempre registrarla, con o senza tavoli assegnati (se senza, resta
   * nella coda "senza tavolo" finché non vengono assegnati). I tavoli
   * scelti, se indicati, devono però essere liberi in quella finestra
   * oraria: due prenotazioni non possono mai condividere lo stesso
   * tavolo, nemmeno dal backoffice. Più tavoli sono ammessi (un gruppo
   * grande che ne occupa più di uno, §10 di DEVELOPMENT.md). Considerata
   * già accettata dallo staff: nasce direttamente CONFIRMED, non PENDING.
   */
  async createManualReservation(user: AuthenticatedUser, venueId: string, dto: CreateManualReservationDto) {
    const venue = await this.getVenueSettings(venueId);
    const reservedAt = new Date(dto.reservedAt);
    if (Number.isNaN(reservedAt.getTime())) {
      throw new BadRequestException('Data/ora non valida');
    }
    const tableIds = [...new Set(dto.tableIds ?? [])];
    if (tableIds.length > 0) {
      await this.requireOwnTables(venueId, tableIds);
      await this.ensureTablesAvailable(
        venueId,
        tableIds,
        reservedAt,
        this.effectiveDuration({ slotDurationMinutes: dto.slotDurationMinutes ?? null }, venue.reservationSlotDurationMinutes),
        venue.reservationSlotDurationMinutes,
      );
    }

    const reservation = flattenTables(
      await this.prisma.reservation.create({
        data: {
          venueId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email.trim().toLowerCase(),
          phone: dto.phone,
          partySize: dto.partySize,
          reservedAt,
          isEvent: dto.isEvent ?? false,
          eventNote: dto.eventNote,
          allergiesNote: dto.allergiesNote,
          notes: dto.notes,
          marketingConsent: dto.marketingConsent ?? false,
          privacyPolicyConsent: dto.privacyPolicyConsent ?? true,
          status: ReservationStatus.CONFIRMED,
          tables: { create: tableIds.map((tableId) => ({ tableId })) },
          slotDurationMinutes: dto.slotDurationMinutes ?? null,
          manageToken: randomUUID(),
          respondedById: user.userId,
          respondedAt: new Date(),
        },
        include: TABLES_INCLUDE,
      }),
    );

    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'Reservation',
      entityId: reservation.id,
      action: 'CREATE',
      after: reservation,
    });
    const customer = await this.customers.recordReservation(venueId, {
      firstName: reservation.firstName,
      lastName: reservation.lastName,
      email: reservation.email,
      phone: reservation.phone,
      marketingConsent: reservation.marketingConsent,
    });
    await this.mail.sendConfirmed(
      reservation,
      venue.name,
      venue.email,
      this.buildSelfManageUrl(venue, reservation.id, reservation.manageToken),
      venue.menuPhone,
      this.buildPrivacyUrl(venue, customer.privacyToken),
      this.venueLogoUrl(venue),
    );
    return reservation;
  }

  private async requireReservation(venueId: string, reservationId: string): Promise<ReservationWithTables> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: TABLES_INCLUDE,
    });
    if (!reservation || reservation.venueId !== venueId) {
      throw new NotFoundException('Prenotazione non trovata');
    }
    return reservation;
  }

  private async requireOwnTable(venueId: string, tableId: string): Promise<Table> {
    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table || table.venueId !== venueId) {
      throw new NotFoundException('Tavolo non trovato');
    }
    return table;
  }

  private async requireOwnTables(venueId: string, tableIds: string[]): Promise<void> {
    await Promise.all(tableIds.map((tableId) => this.requireOwnTable(venueId, tableId)));
  }

  async accept(user: AuthenticatedUser, venueId: string, reservationId: string, tableIds?: string[]) {
    const before = flattenTables(await this.requireReservation(venueId, reservationId));
    return this.applyAccept(before, tableIds, user.userId);
  }

  async reject(user: AuthenticatedUser, venueId: string, reservationId: string, dto: RejectReservationDto) {
    const before = flattenTables(await this.requireReservation(venueId, reservationId));
    return this.applyReject(before, dto.reason, user.userId);
  }

  /** Prenotazione + tavoli attivi liberi del locale (quelli occupati da un'altra prenotazione attiva non compaiono), per la pagina pubblica di gestione (link nell'email al locale). */
  async getForManage(reservationId: string, token: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: TABLES_INCLUDE,
    });
    if (!reservation || reservation.manageToken !== token) {
      throw new NotFoundException('Prenotazione non trovata');
    }
    const venue = await this.getVenueSettings(reservation.venueId);
    const tables = await this.prisma.table.findMany({
      where: { venueId: reservation.venueId, active: true },
      orderBy: { seats: 'asc' },
    });
    const targetDuration = this.effectiveDuration(reservation, venue.reservationSlotDurationMinutes);
    const busyTableIds = await this.getBusyTableIds(
      reservation.venueId,
      reservation.reservedAt,
      targetDuration,
      venue.reservationSlotDurationMinutes,
      reservation.id,
    );
    return {
      reservation: flattenTables(reservation),
      tables: tables.filter((t) => !busyTableIds.has(t.id)),
    };
  }

  /** Accetta/rifiuta senza login, dal link Accetta/Rifiuta nell'email al locale. */
  async acceptByToken(reservationId: string, token: string, tableIds?: string[]) {
    const { reservation } = await this.getForManage(reservationId, token);
    return this.applyAccept(reservation, tableIds, null);
  }

  async rejectByToken(reservationId: string, token: string, reason: string) {
    const { reservation } = await this.getForManage(reservationId, token);
    return this.applyReject(reservation, reason, null);
  }

  /** `respondedById` è null quando l'azione arriva dal link email (nessun utente autenticato): niente audit log in quel caso, non essendo attribuibile a un account specifico. */
  private async applyAccept(
    before: Reservation & { tableIds: string[] },
    tableIds: string[] | undefined,
    respondedById: string | null,
  ) {
    if (before.status !== ReservationStatus.PENDING) {
      throw new BadRequestException('Prenotazione già gestita');
    }
    const finalTableIds = [...new Set(tableIds !== undefined ? tableIds : before.tableIds)];
    const venue = await this.getVenueSettings(before.venueId);
    if (finalTableIds.length > 0) {
      await this.requireOwnTables(before.venueId, finalTableIds);
      await this.ensureTablesAvailable(
        before.venueId,
        finalTableIds,
        before.reservedAt,
        this.effectiveDuration(before, venue.reservationSlotDurationMinutes),
        venue.reservationSlotDurationMinutes,
        before.id,
      );
    }

    const after = flattenTables(
      await this.prisma.reservation.update({
        where: { id: before.id },
        data: {
          status: ReservationStatus.CONFIRMED,
          tables: { deleteMany: {}, create: finalTableIds.map((tableId) => ({ tableId })) },
          respondedById,
          respondedAt: new Date(),
        },
        include: TABLES_INCLUDE,
      }),
    );

    if (respondedById) {
      await this.audit.log({
        venueId: before.venueId,
        userId: respondedById,
        entity: 'Reservation',
        entityId: before.id,
        action: 'UPDATE',
        before,
        after,
      });
    }
    const privacyToken = await this.customers.ensurePrivacyToken(before.venueId, after.email);
    await this.mail.sendConfirmed(
      after,
      venue.name,
      venue.email,
      this.buildSelfManageUrl(venue, after.id, after.manageToken),
      venue.menuPhone,
      this.buildPrivacyUrl(venue, privacyToken),
      this.venueLogoUrl(venue),
    );
    return after;
  }

  private async applyReject(
    before: Reservation & { tableIds: string[] },
    reason: string,
    respondedById: string | null,
  ) {
    if (before.status !== ReservationStatus.PENDING) {
      throw new BadRequestException('Prenotazione già gestita');
    }
    const venue = await this.getVenueSettings(before.venueId);
    const after = flattenTables(
      await this.prisma.reservation.update({
        where: { id: before.id },
        data: {
          status: ReservationStatus.REJECTED,
          rejectionReason: reason,
          respondedById,
          respondedAt: new Date(),
        },
        include: TABLES_INCLUDE,
      }),
    );

    if (respondedById) {
      await this.audit.log({
        venueId: before.venueId,
        userId: respondedById,
        entity: 'Reservation',
        entityId: before.id,
        action: 'UPDATE',
        before,
        after,
      });
    }
    const privacyToken = await this.customers.ensurePrivacyToken(before.venueId, after.email);
    await this.mail.sendRejected(
      after,
      venue.name,
      reason,
      venue.email,
      this.buildPrivacyUrl(venue, privacyToken),
      this.venueLogoUrl(venue),
    );
    return after;
  }

  /** Cancellazione da parte dell'admin di una prenotazione confermata (es. il cliente disdice per telefono). */
  async cancel(user: AuthenticatedUser, venueId: string, reservationId: string) {
    const before = await this.requireReservation(venueId, reservationId);
    if (before.status !== ReservationStatus.CONFIRMED && before.status !== ReservationStatus.PENDING) {
      throw new BadRequestException('Prenotazione già chiusa');
    }
    const venue = await this.getVenueSettings(venueId);
    const after = flattenTables(
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.CANCELLED, respondedById: user.userId, respondedAt: new Date() },
        include: TABLES_INCLUDE,
      }),
    );
    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'Reservation',
      entityId: reservationId,
      action: 'UPDATE',
      before,
      after,
    });
    const privacyToken = await this.customers.ensurePrivacyToken(venueId, after.email);
    await this.mail.sendCancelled(
      after,
      venue.name,
      venue.email,
      this.buildPrivacyUrl(venue, privacyToken),
      this.venueLogoUrl(venue),
    );
    return after;
  }

  /**
   * Riassegnazione manuale dei tavoli, in qualunque momento (anche su una
   * prenotazione già confermata) — rifiuta un tavolo già occupato da
   * un'altra prenotazione attiva nella stessa finestra oraria. Più tavoli
   * sono ammessi (gruppo grande accostato manualmente, §10 di
   * DEVELOPMENT.md); un elenco vuoto rimuove ogni assegnazione.
   */
  async reassignTables(venueId: string, reservationId: string, tableIds: string[]) {
    const reservation = await this.requireReservation(venueId, reservationId);
    if (
      reservation.status === ReservationStatus.REJECTED ||
      reservation.status === ReservationStatus.CANCELLED
    ) {
      throw new BadRequestException('Prenotazione chiusa: non è possibile modificare il tavolo');
    }
    const uniqueTableIds = [...new Set(tableIds)];
    if (uniqueTableIds.length > 0) {
      await this.requireOwnTables(venueId, uniqueTableIds);
      const venue = await this.getVenueSettings(venueId);
      await this.ensureTablesAvailable(
        venueId,
        uniqueTableIds,
        reservation.reservedAt,
        this.effectiveDuration(reservation, venue.reservationSlotDurationMinutes),
        venue.reservationSlotDurationMinutes,
        reservationId,
      );
    }
    return flattenTables(
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { tables: { deleteMany: {}, create: uniqueTableIds.map((tableId) => ({ tableId })) } },
        include: TABLES_INCLUDE,
      }),
    );
  }

  /**
   * Il locale propone un nuovo orario per una prenotazione già presa in
   * carico, all'atto dell'accettazione o in un momento successivo (§10 di
   * DEVELOPMENT.md): non cambia subito "reservedAt", chiede prima
   * conferma al cliente via email (link alla stessa pagina pubblica di
   * gestione). Come per l'aggiunta manuale, non applica i vincoli di
   * orario/fasce del widget pubblico: è un'azione dello staff.
   */
  async proposeTimeChange(
    user: AuthenticatedUser,
    venueId: string,
    reservationId: string,
    dto: ProposeTimeChangeDto,
  ) {
    const reservation = await this.requireReservation(venueId, reservationId);
    if (
      reservation.status === ReservationStatus.REJECTED ||
      reservation.status === ReservationStatus.CANCELLED
    ) {
      throw new BadRequestException("Prenotazione chiusa: non è possibile modificare l'orario");
    }
    const proposedReservedAt = new Date(dto.reservedAt);
    if (Number.isNaN(proposedReservedAt.getTime())) {
      throw new BadRequestException('Data/ora non valida');
    }

    const venue = await this.getVenueSettings(venueId);
    const updated = flattenTables(
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { proposedReservedAt },
        include: TABLES_INCLUDE,
      }),
    );

    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'Reservation',
      entityId: reservationId,
      action: 'UPDATE',
      before: reservation,
      after: updated,
    });

    const confirmUrl = this.buildManageUrl(venue, reservationId, updated.manageToken);
    const privacyToken = await this.customers.ensurePrivacyToken(venueId, updated.email);
    await this.mail.sendTimeChangeRequest(
      updated,
      venue.name,
      confirmUrl,
      venue.email,
      this.buildPrivacyUrl(venue, privacyToken),
      this.venueLogoUrl(venue),
    );
    return updated;
  }

  /** Il cliente confema il nuovo orario proposto, dal link nell'email (nessun login). */
  async confirmTimeChangeByToken(reservationId: string, token: string) {
    const { reservation } = await this.getForManage(reservationId, token);
    if (!reservation.proposedReservedAt) {
      throw new BadRequestException('Nessun nuovo orario da confermare');
    }

    const updated = await this.prisma.reservation.update({
      where: { id: reservationId },
      data: { reservedAt: reservation.proposedReservedAt, proposedReservedAt: null },
      include: TABLES_INCLUDE,
    });

    const admins = await this.prisma.user.findMany({ where: { venueId: reservation.venueId, role: 'ADMIN' } });
    await this.prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: 'RESERVATION_TIME_CONFIRMED',
        message: `${reservation.firstName} ${reservation.lastName} ha confermato il nuovo orario: ${updated.reservedAt.toLocaleString('it-IT')}`,
      })),
    });

    return flattenTables(updated);
  }

  /**
   * Modifica generale (dati cliente, note, durata di occupazione): a
   * differenza del cambio orario non richiede conferma del cliente — per
   * correggere un dato inserito male o aggiornare una nota, non per
   * rinegoziare l'appuntamento. Non applicabile a prenotazioni chiuse
   * (rifiutate/annullate).
   */
  async updateReservation(
    user: AuthenticatedUser,
    venueId: string,
    reservationId: string,
    dto: UpdateReservationDto,
  ) {
    const before = await this.requireReservation(venueId, reservationId);
    if (
      before.status === ReservationStatus.REJECTED ||
      before.status === ReservationStatus.CANCELLED
    ) {
      throw new BadRequestException('Prenotazione chiusa: non è possibile modificarla');
    }

    const data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      partySize?: number;
      isEvent?: boolean;
      eventNote?: string | null;
      allergiesNote?: string | null;
      notes?: string | null;
      slotDurationMinutes?: number | null;
    } = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.partySize !== undefined) data.partySize = dto.partySize;
    if (dto.isEvent !== undefined) data.isEvent = dto.isEvent;
    if (dto.eventNote !== undefined) data.eventNote = dto.eventNote;
    if (dto.allergiesNote !== undefined) data.allergiesNote = dto.allergiesNote;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.slotDurationMinutes !== undefined) data.slotDurationMinutes = dto.slotDurationMinutes;

    const after = flattenTables(
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data,
        include: TABLES_INCLUDE,
      }),
    );

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

  // ---- Auto-gestione del cliente (senza login, entro SELF_EDIT_WINDOW_MINUTES) --------

  /**
   * Dati per la pagina pubblica di auto-gestione del cliente (§10 di
   * DEVELOPMENT.md, diversa da getForManage: quella è per lo staff, con
   * Accetta/Rifiuta — questa non espone mai quelle azioni). `canEdit` è
   * già calcolato qui (finestra + stato), così il frontend non deve
   * rifare il calcolo: mostra il form se true, altrimenti l'invito a
   * chiamare `venuePhone`.
   */
  async getForSelfManage(reservationId: string, token: string) {
    const reservation = await this.requireByToken(reservationId, token);
    const venue = await this.getVenueSettings(reservation.venueId);
    return {
      reservation,
      venueName: venue.name,
      venuePhone: venue.menuPhone,
      editableUntil: this.selfEditDeadline(reservation),
      canEdit: this.canSelfEdit(reservation),
    };
  }

  /**
   * Modifica da parte del cliente (dati di contatto, numero di persone,
   * occasione speciale, note — non l'orario, che resta un'azione del
   * locale via proponi/conferma, né i tavoli, di competenza dello staff).
   * Torna sempre PENDING, qualunque fosse lo stato prima (anche se già
   * CONFIRMED): su richiesta esplicita dell'utente, ogni modifica del
   * cliente va rivista e riconfermata dal locale, riusando lo stesso
   * meccanismo di conferma di una richiesta nuova (email al locale con
   * Accetta/Rifiuta, Notification in-app, §5.7).
   */
  async updateBySelfToken(reservationId: string, token: string, dto: SelfUpdateReservationDto) {
    const before = await this.requireByToken(reservationId, token);
    if (!this.canSelfEdit(before)) {
      throw new BadRequestException(
        'Il tempo per modificare questa prenotazione online è scaduto: chiamaci direttamente per qualsiasi modifica.',
      );
    }

    const data: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      partySize?: number;
      isEvent?: boolean;
      eventNote?: string | null;
      allergiesNote?: string | null;
      notes?: string | null;
    } = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.partySize !== undefined) data.partySize = dto.partySize;
    if (dto.isEvent !== undefined) data.isEvent = dto.isEvent;
    if (dto.eventNote !== undefined) data.eventNote = dto.eventNote;
    if (dto.allergiesNote !== undefined) data.allergiesNote = dto.allergiesNote;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const after = flattenTables(
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { ...data, status: ReservationStatus.PENDING, respondedById: null, respondedAt: null },
        include: TABLES_INCLUDE,
      }),
    );

    const venue = await this.getVenueSettings(after.venueId);
    const logoUrl = this.venueLogoUrl(venue);
    const privacyToken = await this.customers.ensurePrivacyToken(after.venueId, after.email);
    await this.mail.sendSelfEditPending(
      after,
      venue.name,
      venue.email,
      this.buildPrivacyUrl(venue, privacyToken),
      logoUrl,
    );

    const admins = await this.prisma.user.findMany({ where: { venueId: after.venueId, role: 'ADMIN' } });
    await this.prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: 'RESERVATION_PENDING',
        message: `Prenotazione modificata dal cliente, da confermare: ${after.firstName} ${after.lastName}, ${after.partySize} persone`,
      })),
    });

    if (venue.email) {
      const manageUrl = this.buildManageUrl(venue, after.id, after.manageToken);
      await this.mail.sendModifiedNotificationToVenue(after, venue.name, venue.email, manageUrl, logoUrl);
    }

    return after;
  }

  /**
   * Annullamento da parte del cliente, stessa finestra della modifica: a
   * differenza della modifica, non richiede conferma del locale (annullare
   * non ha bisogno di revisione) — solo un avviso in-app agli admin, sullo
   * stesso principio di confirmTimeChangeByToken.
   */
  async cancelBySelfToken(reservationId: string, token: string) {
    const before = await this.requireByToken(reservationId, token);
    if (!this.canSelfEdit(before)) {
      throw new BadRequestException('Il tempo per annullare questa prenotazione online è scaduto: chiamaci direttamente.');
    }

    const after = flattenTables(
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.CANCELLED },
        include: TABLES_INCLUDE,
      }),
    );

    const admins = await this.prisma.user.findMany({ where: { venueId: after.venueId, role: 'ADMIN' } });
    await this.prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: 'RESERVATION_CANCELLED_BY_CUSTOMER',
        message: `${after.firstName} ${after.lastName} ha annullato la propria prenotazione del ${after.reservedAt.toLocaleString('it-IT')}`,
      })),
    });

    return after;
  }
}
