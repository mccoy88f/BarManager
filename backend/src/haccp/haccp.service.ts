import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { CreateFridgeDto } from './dto/create-fridge.dto';
import { CreateReadingDto } from './dto/create-reading.dto';

@Injectable()
export class HaccpService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ---- Frigoriferi (censiti dall'admin) ------------------------------

  createFridge(venueId: string, dto: CreateFridgeDto) {
    return this.prisma.fridge.create({ data: { ...dto, venueId } });
  }

  listFridges(venueId: string) {
    return this.prisma.fridge.findMany({ where: { venueId, active: true } });
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

  listReadings(venueId: string, from?: string, to?: string) {
    // "to" arriva come data (es. "2026-09-21"), che new Date() interpreta come
    // mezzanotte UTC: senza estenderla a fine giornata, "lte" escluderebbe di
    // fatto tutte le rilevazioni del giorno stesso (bug che rendeva vuoto
    // anche il report/stampa HACCP, che usa la stessa data sia per from che to).
    const toDate = to ? new Date(to) : undefined;
    toDate?.setUTCHours(23, 59, 59, 999);

    return this.prisma.temperatureReading.findMany({
      where: {
        fridge: { venueId },
        recordedAt: {
          gte: from ? new Date(from) : undefined,
          lte: toDate,
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
