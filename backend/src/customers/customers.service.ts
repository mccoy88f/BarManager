import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { XlsxService } from '../reports/xlsx.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const IMPORT_COLUMNS = {
  clientId: 'Client ID',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  marketingConsent: 'Marketing Consent',
  reservationsCount: 'Total Reservation',
  lastReservationDate: 'Last Reservation Date (YYYY-MM-DD)',
  lastReservationTime: 'Last Reservation',
} as const;

/** Combina una cella data (Date o stringa "YYYY-MM-DD") e una cella ora (Date o stringa "HH:mm") in un unico Date UTC. */
function combineDateAndTime(dateValue: unknown, timeValue: unknown): Date | undefined {
  let year: number;
  let month: number;
  let day: number;
  if (dateValue instanceof Date) {
    year = dateValue.getUTCFullYear();
    month = dateValue.getUTCMonth();
    day = dateValue.getUTCDate();
  } else if (typeof dateValue === 'string' && dateValue.trim()) {
    const parsed = new Date(dateValue.trim());
    if (Number.isNaN(parsed.getTime())) return undefined;
    year = parsed.getUTCFullYear();
    month = parsed.getUTCMonth();
    day = parsed.getUTCDate();
  } else {
    return undefined;
  }

  let hours = 0;
  let minutes = 0;
  if (timeValue instanceof Date) {
    hours = timeValue.getUTCHours();
    minutes = timeValue.getUTCMinutes();
  } else if (typeof timeValue === 'string' && /^\d{1,2}:\d{2}/.test(timeValue.trim())) {
    const [h, m] = timeValue.trim().split(':');
    hours = Number(h);
    minutes = Number(m);
  }
  return new Date(Date.UTC(year, month, day, hours, minutes));
}

function cellToString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function cellToBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return cellToString(value).toUpperCase() === 'YES';
}

/**
 * Anagrafica clienti (§5.8 di DEVELOPMENT.md). Il CRUD qui è per la gestione
 * manuale dell'admin: la creazione/aggiornamento automatico a ogni
 * prenotazione (firstReservationAt/lastReservationAt/reservationsCount) è
 * in reservations.service.ts (upsertCustomerFromReservation), condiviso fra
 * prenotazione pubblica e aggiunta manuale.
 */
@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private xlsx: XlsxService,
  ) {}

  list(venueId: string) {
    return this.prisma.customer.findMany({
      where: { venueId },
      orderBy: { lastReservationAt: 'desc' },
    });
  }

  async get(venueId: string, customerId: string) {
    return this.requireOwnCustomer(venueId, customerId);
  }

  async create(venueId: string, dto: CreateCustomerDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.customer.findUnique({
      where: { venueId_email: { venueId, email } },
    });
    if (existing) {
      throw new ConflictException('Esiste già un cliente con questa email');
    }
    return this.prisma.customer.create({
      data: {
        venueId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        phone: dto.phone,
        notes: dto.notes,
        // Sempre false qui: il consenso marketing lo dà solo il cliente
        // stesso (alla prenotazione o dalla pagina "gestisci i tuoi dati
        // personali"), mai lo staff con l'inserimento manuale.
        marketingConsent: false,
      },
    });
  }

  async update(venueId: string, customerId: string, dto: UpdateCustomerDto) {
    await this.requireOwnCustomer(venueId, customerId);
    const data: Partial<{
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
      notes: string | null;
    }> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.notes !== undefined) data.notes = dto.notes;
    // marketingConsent non è modificabile da qui: v. nota su UpdateCustomerDto.
    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.prisma.customer.findUnique({
        where: { venueId_email: { venueId, email } },
      });
      if (existing && existing.id !== customerId) {
        throw new ConflictException('Esiste già un cliente con questa email');
      }
      data.email = email;
    }
    return this.prisma.customer.update({ where: { id: customerId }, data });
  }

  async remove(venueId: string, customerId: string) {
    await this.requireOwnCustomer(venueId, customerId);
    await this.prisma.customer.delete({ where: { id: customerId } });
  }

  /**
   * Crea o aggiorna il cliente a ogni nuova prenotazione (pubblica o
   * manuale, v. reservations.service.ts): "firstReservationAt" resta quello
   * della primissima volta (data di "registrazione"), "lastReservationAt"
   * si aggiorna a ogni prenotazione — pensato anche come proxy di
   * aggiornamento consensi per future campagne marketing (v. nota GDPR in
   * DEVELOPMENT.md: non implica da sola un consenso esplicito). Usa il
   * momento della richiesta (adesso), non la data/ora della prenotazione
   * stessa, che può essere nel futuro.
   */
  async recordReservation(
    venueId: string,
    data: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      marketingConsent: boolean;
    },
  ) {
    const email = data.email.trim().toLowerCase();
    const now = new Date();
    const customer = await this.prisma.customer.upsert({
      where: { venueId_email: { venueId, email } },
      create: {
        venueId,
        firstName: data.firstName,
        lastName: data.lastName,
        email,
        phone: data.phone,
        marketingConsent: data.marketingConsent,
        firstReservationAt: now,
        lastReservationAt: now,
        reservationsCount: 1,
        privacyToken: randomUUID(),
      },
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        marketingConsent: data.marketingConsent,
        lastReservationAt: now,
        reservationsCount: { increment: 1 },
        // privacyToken NON toccato qui: deve restare stabile una volta
        // generato, altrimenti un link "gestisci i tuoi dati" mandato in
        // un'email precedente smetterebbe di funzionare. Un cliente creato
        // prima di questo campo (privacyToken ancora null) lo riceve al
        // volo sotto.
      },
    });
    if (!customer.privacyToken) {
      return this.prisma.customer.update({
        where: { id: customer.id },
        data: { privacyToken: randomUUID() },
      });
    }
    return customer;
  }

  /**
   * Equivalente a recordReservation sopra, ma per gli ordini online (§5.10
   * di DEVELOPMENT.md): "ordersCount"/"firstOrderAt"/"lastOrderAt"
   * aggiornati ad ogni ordine creato (qualunque sia il suo stato finale,
   * come reservationsCount), mentre "totalOrdersSpent" resta a parte —
   * v. recordOnlineOrderCompleted sotto, aggiornato solo alla chiusura.
   */
  async recordOnlineOrder(
    venueId: string,
    data: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      marketingConsent: boolean;
    },
  ) {
    const email = data.email.trim().toLowerCase();
    const now = new Date();
    const customer = await this.prisma.customer.upsert({
      where: { venueId_email: { venueId, email } },
      create: {
        venueId,
        firstName: data.firstName,
        lastName: data.lastName,
        email,
        phone: data.phone,
        marketingConsent: data.marketingConsent,
        firstOrderAt: now,
        lastOrderAt: now,
        ordersCount: 1,
        privacyToken: randomUUID(),
      },
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        marketingConsent: data.marketingConsent,
        lastOrderAt: now,
        ordersCount: { increment: 1 },
      },
    });
    if (!customer.privacyToken) {
      return this.prisma.customer.update({
        where: { id: customer.id },
        data: { privacyToken: randomUUID() },
      });
    }
    return customer;
  }

  /** Incrementa la spesa totale di un cliente: chiamato solo alla chiusura effettiva di un OnlineOrder (COMPLETED), mai alla sola creazione. */
  recordOnlineOrderCompleted(customerId: string, orderTotal: number) {
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { totalOrdersSpent: { increment: orderTotal } },
    });
  }

  /**
   * Garantisce (generandolo se assente) il token per la pagina pubblica
   * "gestisci i tuoi dati personali", per un cliente già esistente (es.
   * prima di mandare un'email che deve includere quel link, ma senza
   * passare da recordReservation — accetta/rifiuta, annulla, ecc.). Se il
   * cliente non esiste ancora per qualche motivo, restituisce null: il
   * chiamante allora costruisce l'email senza quel link, piuttosto che
   * fallire l'invio.
   */
  async ensurePrivacyToken(venueId: string, email: string): Promise<string | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const customer = await this.prisma.customer.findUnique({
      where: { venueId_email: { venueId, email: normalizedEmail } },
    });
    if (!customer) return null;
    if (customer.privacyToken) return customer.privacyToken;
    const updated = await this.prisma.customer.update({
      where: { id: customer.id },
      data: { privacyToken: randomUUID() },
    });
    return updated.privacyToken;
  }

  /**
   * Dati per la pagina pubblica "gestisci i tuoi dati personali" (§5.8,
   * link in fondo alle email di prenotazione): il token è l'unico
   * identificativo nel link, unico a livello globale (non solo per
   * locale), quindi qui non serve alcun venueId.
   */
  async getForPrivacyPage(token: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { privacyToken: token },
      include: { venue: { select: { name: true } } },
    });
    if (!customer) throw new NotFoundException('Link non valido');
    return {
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      marketingConsent: customer.marketingConsent,
      venueName: customer.venue.name,
    };
  }

  /** Rimuove il consenso marketing dalla pagina pubblica, senza login (§5.8). */
  async optOutMarketingByToken(token: string) {
    const customer = await this.prisma.customer.findUnique({ where: { privacyToken: token } });
    if (!customer) throw new NotFoundException('Link non valido');
    await this.prisma.customer.update({ where: { id: customer.id }, data: { marketingConsent: false } });
  }

  /**
   * Attiva il consenso marketing dalla stessa pagina pubblica (§5.8):
   * unico altro punto, insieme alla prenotazione, da cui il consenso può
   * essere dato (mai dallo staff, v. CreateCustomerDto/UpdateCustomerDto).
   */
  async optInMarketingByToken(token: string) {
    const customer = await this.prisma.customer.findUnique({ where: { privacyToken: token } });
    if (!customer) throw new NotFoundException('Link non valido');
    await this.prisma.customer.update({ where: { id: customer.id }, data: { marketingConsent: true } });
  }

  /**
   * Elimina la scheda cliente dalla pagina pubblica, senza login (§5.8):
   * rimuove solo l'anagrafica (nome/cognome/email/telefono/note/consenso),
   * non le prenotazioni già effettuate presso il locale, che restano nello
   * storico operativo del locale (§5.7) — distinzione dichiarata anche in
   * pagina, non solo qui.
   */
  async deleteByToken(token: string) {
    const customer = await this.prisma.customer.findUnique({ where: { privacyToken: token } });
    if (!customer) throw new NotFoundException('Link non valido');
    await this.prisma.customer.delete({ where: { id: customer.id } });
  }

  /** Esporta l'anagrafica clienti in xlsx, stesso formato accettato da importXlsx (v. sotto). */
  async exportXlsx(venueId: string): Promise<Buffer> {
    const customers = await this.prisma.customer.findMany({
      where: { venueId },
      orderBy: { lastReservationAt: 'desc' },
    });
    const rows = customers.map((c) => ({
      clientId: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone ?? '',
      marketingConsent: c.marketingConsent ? 'YES' : 'NO',
      reservationsCount: c.reservationsCount,
      lastReservationDate: c.lastReservationAt ? c.lastReservationAt.toISOString().slice(0, 10) : '',
      lastReservationTime: c.lastReservationAt ? c.lastReservationAt.toISOString().slice(11, 16) : '',
    }));
    return this.xlsx.buildSheet(
      'Clienti',
      [
        { header: IMPORT_COLUMNS.clientId, key: 'clientId', width: 28 },
        { header: IMPORT_COLUMNS.firstName, key: 'firstName', width: 18 },
        { header: IMPORT_COLUMNS.lastName, key: 'lastName', width: 18 },
        { header: IMPORT_COLUMNS.email, key: 'email', width: 30 },
        { header: IMPORT_COLUMNS.phone, key: 'phone', width: 16 },
        { header: IMPORT_COLUMNS.marketingConsent, key: 'marketingConsent', width: 16 },
        { header: IMPORT_COLUMNS.reservationsCount, key: 'reservationsCount', width: 16 },
        { header: IMPORT_COLUMNS.lastReservationDate, key: 'lastReservationDate', width: 30 },
        { header: IMPORT_COLUMNS.lastReservationTime, key: 'lastReservationTime', width: 16 },
      ],
      rows,
    );
  }

  /**
   * Importa clienti da xlsx (stesso formato di exportXlsx, colonne
   * identificate per intestazione, non per posizione). Per ogni riga: se
   * "Client ID" è vuoto viene generato automaticamente (nuovo cliente); se
   * presente e già esistente (in questo locale) i dati vengono confrontati
   * e aggiornati; se presente ma non trovato, viene creato un nuovo cliente
   * con quell'id (utile per import da un altro sistema che assegna già i
   * propri id). Senza "Client ID", un'email già presente aggiorna comunque
   * il cliente esistente invece di duplicarlo. Una riga non valida non
   * blocca le altre: l'errore viene raccolto e riportato a fine importazione.
   */
  async importXlsx(
    venueId: string,
    buffer: Buffer,
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    const rows = await this.xlsx.readSheet(buffer);
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2; // riga 1 = intestazioni
      try {
        const firstName = cellToString(row[IMPORT_COLUMNS.firstName]);
        const lastName = cellToString(row[IMPORT_COLUMNS.lastName]);
        const email = cellToString(row[IMPORT_COLUMNS.email]).toLowerCase();
        if (!firstName || !lastName || !email) {
          errors.push(`Riga ${rowNumber}: nome, cognome ed email sono obbligatori`);
          continue;
        }

        const phone = cellToString(row[IMPORT_COLUMNS.phone]) || undefined;
        const marketingConsent = cellToBoolean(row[IMPORT_COLUMNS.marketingConsent]);
        const reservationsCountRaw = row[IMPORT_COLUMNS.reservationsCount];
        const reservationsCount =
          reservationsCountRaw != null && reservationsCountRaw !== ''
            ? Number(reservationsCountRaw)
            : undefined;
        const lastReservationAt = combineDateAndTime(
          row[IMPORT_COLUMNS.lastReservationDate],
          row[IMPORT_COLUMNS.lastReservationTime],
        );
        const clientId = cellToString(row[IMPORT_COLUMNS.clientId]) || undefined;

        let existing = clientId ? await this.prisma.customer.findUnique({ where: { id: clientId } }) : null;
        if (existing && existing.venueId !== venueId) {
          errors.push(`Riga ${rowNumber}: Client ID "${clientId}" appartiene a un altro locale`);
          continue;
        }
        if (!existing) {
          existing = await this.prisma.customer.findUnique({ where: { venueId_email: { venueId, email } } });
        }

        const sharedData = {
          firstName,
          lastName,
          email,
          phone,
          marketingConsent,
          ...(reservationsCount != null && !Number.isNaN(reservationsCount) ? { reservationsCount } : {}),
          ...(lastReservationAt ? { lastReservationAt } : {}),
        };

        if (existing) {
          await this.prisma.customer.update({
            where: { id: existing.id },
            data: {
              ...sharedData,
              firstReservationAt: existing.firstReservationAt ?? lastReservationAt,
            },
          });
          updated++;
        } else {
          await this.prisma.customer.create({
            data: {
              ...(clientId ? { id: clientId } : {}),
              venueId,
              ...sharedData,
              reservationsCount: reservationsCount ?? 0,
              firstReservationAt: lastReservationAt,
            },
          });
          created++;
        }
      } catch (err) {
        errors.push(`Riga ${rowNumber}: ${err instanceof Error ? err.message : 'errore sconosciuto'}`);
      }
    }

    return { created, updated, errors };
  }

  private async requireOwnCustomer(venueId: string, customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.venueId !== venueId) {
      throw new NotFoundException('Cliente non trovato');
    }
    return customer;
  }
}
