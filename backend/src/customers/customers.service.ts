import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/**
 * Anagrafica clienti (§5.8 di DEVELOPMENT.md). Il CRUD qui è per la gestione
 * manuale dell'admin: la creazione/aggiornamento automatico a ogni
 * prenotazione (firstReservationAt/lastReservationAt/reservationsCount) è
 * in reservations.service.ts (upsertCustomerFromReservation), condiviso fra
 * prenotazione pubblica e aggiunta manuale.
 */
@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

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
    data: { firstName: string; lastName: string; email: string; phone: string },
  ) {
    const email = data.email.trim().toLowerCase();
    const now = new Date();
    await this.prisma.customer.upsert({
      where: { venueId_email: { venueId, email } },
      create: {
        venueId,
        firstName: data.firstName,
        lastName: data.lastName,
        email,
        phone: data.phone,
        firstReservationAt: now,
        lastReservationAt: now,
        reservationsCount: 1,
      },
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        lastReservationAt: now,
        reservationsCount: { increment: 1 },
      },
    });
  }

  private async requireOwnCustomer(venueId: string, customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.venueId !== venueId) {
      throw new NotFoundException('Cliente non trovato');
    }
    return customer;
  }
}
