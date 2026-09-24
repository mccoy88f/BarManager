import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { parseDateOnlyEndOfDayInZone, parseDateOnlyStartOfDayInZone } from '../common/timezone/timezone';
import { CreateFridgeDto } from './dto/create-fridge.dto';
import { UpdateFridgeDto } from './dto/update-fridge.dto';
import { CreateReadingDto } from './dto/create-reading.dto';

@Injectable()
export class HaccpService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Nome di chi firma il report HACCP: non va chiesto a mano nel form (chi
   * stampa/firma è sempre chi ha effettuato il login, non serve chiederlo
   * di nuovo, ed evita che qualcuno firmi col nome di un altro) — nome e
   * cognome se l'account ha una scheda `Employee` collegata, altrimenti
   * l'email di login (es. un Admin puro, senza scheda dipendente).
   */
  async resolveSignerName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (!user) throw new NotFoundException('Utente non trovato');
    return user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email;
  }

  // ---- Frigoriferi (censiti dall'admin) ------------------------------

  createFridge(venueId: string, dto: CreateFridgeDto) {
    return this.prisma.fridge.create({ data: { ...dto, venueId } });
  }

  listFridges(venueId: string) {
    return this.prisma.fridge.findMany({ where: { venueId, active: true } });
  }

  async updateFridge(venueId: string, id: string, dto: UpdateFridgeDto) {
    const fridge = await this.prisma.fridge.findUnique({ where: { id } });
    if (!fridge || fridge.venueId !== venueId) {
      throw new NotFoundException('Frigorifero non trovato');
    }
    return this.prisma.fridge.update({ where: { id }, data: dto });
  }

  /** Disattiva il frigorifero senza perdere lo storico delle rilevazioni collegate. */
  async removeFridge(venueId: string, id: string) {
    const fridge = await this.prisma.fridge.findUnique({ where: { id } });
    if (!fridge || fridge.venueId !== venueId) {
      throw new NotFoundException('Frigorifero non trovato');
    }
    await this.prisma.fridge.update({ where: { id }, data: { active: false } });
    return { success: true };
  }

  // ---- Rilevazioni temperatura ------------------------------------------

  async createReading(user: AuthenticatedUser, dto: CreateReadingDto) {
    const venueId = requireVenueId(user);
    const fridge = await this.prisma.fridge.findUnique({ where: { id: dto.fridgeId } });
    if (!fridge || fridge.venueId !== venueId) {
      throw new NotFoundException('Frigorifero non trovato');
    }

    const outOfRange = dto.value < fridge.minTemp || dto.value > fridge.maxTemp;
    if (outOfRange && !dto.correctiveAction) {
      throw new BadRequestException(
        'Temperatura fuori soglia: è obbligatorio indicare l\'azione correttiva',
      );
    }

    const reading = await this.prisma.temperatureReading.create({
      data: {
        fridgeId: dto.fridgeId,
        value: dto.value,
        outOfRange,
        correctiveAction: dto.correctiveAction,
        recordedById: user.userId,
      },
    });

    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'TemperatureReading',
      entityId: reading.id,
      action: 'CREATE',
      after: reading,
    });

    if (outOfRange) {
      const managers = await this.prisma.user.findMany({
        where: { venueId, role: { in: ['ADMIN', 'MANAGER'] } },
      });
      await this.prisma.notification.createMany({
        data: managers.map((m) => ({
          userId: m.id,
          type: 'TEMPERATURE_OUT_OF_RANGE',
          message: `Temperatura fuori soglia su ${fridge.label}: ${dto.value}°C`,
        })),
      });
    }

    return reading;
  }

  async listReadings(venueId: string, from?: string, to?: string) {
    // "to" arriva come data (es. "2026-09-21"): va estesa a fine giornata
    // (nel fuso orario del locale, non UTC) altrimenti "lte" escluderebbe di
    // fatto tutte le rilevazioni del giorno stesso (bug che rendeva vuoto
    // anche il report/stampa HACCP, che usa la stessa data sia per from che to).
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: { timezone: true } });

    return this.prisma.temperatureReading.findMany({
      where: {
        fridge: { venueId },
        recordedAt: {
          gte: from ? parseDateOnlyStartOfDayInZone(from, venue?.timezone) : undefined,
          lte: to ? parseDateOnlyEndOfDayInZone(to, venue?.timezone) : undefined,
        },
      },
      include: { fridge: true, recordedBy: { select: { email: true } } },
      orderBy: { recordedAt: 'desc' },
    });
  }

  /** Chiude/firma il report HACCP del giorno indicato. */
  async signReport(
    venueId: string,
    params: { reportDate: string; signedByName: string; signatureImg?: string; printedOnPos: boolean },
  ) {
    return this.prisma.haccpReport.create({
      data: {
        venueId,
        reportDate: new Date(params.reportDate),
        signedByName: params.signedByName,
        signatureImg: params.signatureImg,
        printedOnPos: params.printedOnPos,
      },
    });
  }

  listReports(venueId: string) {
    return this.prisma.haccpReport.findMany({
      where: { venueId },
      orderBy: { reportDate: 'desc' },
    });
  }
}
