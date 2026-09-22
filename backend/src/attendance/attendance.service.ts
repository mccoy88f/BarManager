import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceApprovalStatus, AttendanceSource, AttendanceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { ClockDto } from './dto/clock.dto';
import { CreateNfcTagDto } from './dto/create-nfc-tag.dto';
import { AddAttendanceRecordDto } from './dto/add-attendance-record.dto';
import { SelfReportAttendanceDto } from './dto/self-report-attendance.dto';
import { buildAttendanceSummary } from './attendance-summary.util';

/** Distanza in metri fra due coordinate (formula haversine). */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async resolveEmployeeId(userId: string): Promise<string> {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) {
      throw new BadRequestException('Utente non collegato a un dipendente');
    }
    return employee.id;
  }

  // ---- QR postazioni --------------------------------------------------

  createQrToken(venueId: string, label: string) {
    return this.prisma.qrToken.create({ data: { venueId, label } });
  }

  listQrTokens(venueId: string) {
    return this.prisma.qrToken.findMany({ where: { venueId, active: true } });
  }

  async updateQrToken(venueId: string, id: string, label: string) {
    const token = await this.prisma.qrToken.findUnique({ where: { id } });
    if (!token || token.venueId !== venueId) {
      throw new NotFoundException('Postazione QR non trovata');
    }
    return this.prisma.qrToken.update({ where: { id }, data: { label } });
  }

  /** Disattiva la postazione senza perdere lo storico delle timbrature già registrate. */
  async removeQrToken(venueId: string, id: string) {
    const token = await this.prisma.qrToken.findUnique({ where: { id } });
    if (!token || token.venueId !== venueId) {
      throw new NotFoundException('Postazione QR non trovata');
    }
    await this.prisma.qrToken.update({ where: { id }, data: { active: false } });
    return { success: true };
  }

  // ---- Tag NFC ----------------------------------------------------------

  async createNfcTag(venueId: string, dto: CreateNfcTagDto) {
    try {
      return await this.prisma.nfcTag.create({
        data: { venueId, label: dto.label, value: dto.value.trim() },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Questo testo è già usato da un altro tag NFC');
      }
      throw e;
    }
  }

  listNfcTags(venueId: string) {
    return this.prisma.nfcTag.findMany({ where: { venueId } });
  }

  async updateNfcTag(venueId: string, id: string, dto: CreateNfcTagDto) {
    const tag = await this.prisma.nfcTag.findUnique({ where: { id } });
    if (!tag || tag.venueId !== venueId) {
      throw new NotFoundException('Tag NFC non trovato');
    }
    try {
      return await this.prisma.nfcTag.update({
        where: { id },
        data: { label: dto.label, value: dto.value.trim() },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Questo testo è già usato da un altro tag NFC');
      }
      throw e;
    }
  }

  async removeNfcTag(venueId: string, tagId: string) {
    const tag = await this.prisma.nfcTag.findUnique({ where: { id: tagId } });
    if (!tag || tag.venueId !== venueId) {
      throw new NotFoundException('Tag NFC non trovato');
    }
    await this.prisma.nfcTag.delete({ where: { id: tagId } });
    return { success: true };
  }

  // ---- Impostazioni timbratura --------------------------------------------

  /** Solo i flag e il raggio: mai le coordinate esatte del locale al client. */
  getClockInSettings(venueId: string) {
    return this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        clockInQrEnabled: true,
        clockInGpsEnabled: true,
        clockInNfcEnabled: true,
        gpsRadiusMeters: true,
      },
    });
  }

  // ---- Timbratura -------------------------------------------------------

  /**
   * Stato corrente del dipendente loggato: cosa può fare (inizio/fine).
   * Ignora le timbrature non ancora confermate (PENDING/REJECTED): una
   * segnalazione "ho dimenticato di timbrare" in attesa di revisione non
   * deve bloccare né alterare la timbratura normale nel frattempo.
   */
  async getCurrentStatus(userId: string) {
    const employeeId = await this.resolveEmployeeId(userId);
    const last = await this.prisma.attendanceRecord.findFirst({
      where: { employeeId, approvalStatus: AttendanceApprovalStatus.CONFIRMED },
      orderBy: { timestamp: 'desc' },
    });
    const nextAction: AttendanceType =
      !last || last.type === AttendanceType.CLOCK_OUT
        ? AttendanceType.CLOCK_IN
        : AttendanceType.CLOCK_OUT;
    return { lastRecord: last, nextAction };
  }

  /**
   * Storico delle proprie timbrature confermate, come turni con ore
   * calcolate (stesso formato usato nei report admin): l'admin può
   * disattivare questa vista per i dipendenti in Impostazioni locale.
   */
  async getOwnHistory(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: { venue: { select: { attendanceHistoryVisibleToEmployees: true } } },
    });
    if (!employee) {
      throw new BadRequestException('Utente non collegato a un dipendente');
    }
    if (!employee.venue.attendanceHistoryVisibleToEmployees) {
      throw new ForbiddenException('Lo storico presenze non è abilitato per i dipendenti in questo locale');
    }

    const records = await this.prisma.attendanceRecord.findMany({
      where: { employeeId: employee.id, approvalStatus: AttendanceApprovalStatus.CONFIRMED },
      include: { employee: true, qrToken: true, nfcTag: true },
      orderBy: { timestamp: 'desc' },
    });
    const [summary] = buildAttendanceSummary(records);
    return (
      summary ?? {
        employeeName: `${employee.firstName} ${employee.lastName}`,
        days: [],
        grandTotalHours: 0,
      }
    );
  }

  /**
   * Timbra inizio/fine turno con uno dei metodi verificati abilitati
   * dall'admin per il locale (più di uno può essere attivo insieme):
   * - qrToken: scansione del QR di una postazione fisica;
   * - nfcValue: testo letto da un tag NFC fisico, confrontato con quelli
   *   censiti dall'admin;
   * - gpsLat/gpsLng: posizione del dispositivo, verificata lato server
   *   contro il punto e il raggio configurati per il locale.
   * Se il locale non ha abilitato nessun metodo, resta disponibile la
   * timbratura diretta senza verifica (comportamento storico, source MANUAL).
   */
  async clock(user: AuthenticatedUser, input: ClockDto) {
    const venueId = requireVenueId(user);
    const employeeId = await this.resolveEmployeeId(user.userId);

    const venue = await this.prisma.venue.findUniqueOrThrow({
      where: { id: venueId },
      select: {
        clockInQrEnabled: true,
        clockInGpsEnabled: true,
        clockInNfcEnabled: true,
        gpsLat: true,
        gpsLng: true,
        gpsRadiusMeters: true,
      },
    });

    let source: AttendanceSource;
    let qrTokenId: string | undefined;
    let nfcTagId: string | undefined;
    let gpsLat: number | undefined;
    let gpsLng: number | undefined;

    if (input.qrToken) {
      if (!venue.clockInQrEnabled) {
        throw new ForbiddenException('Timbratura tramite QR non abilitata per questo locale');
      }
      const qrToken = await this.prisma.qrToken.findUnique({ where: { token: input.qrToken } });
      if (!qrToken || !qrToken.active || qrToken.venueId !== venueId) {
        throw new NotFoundException('QR non valido');
      }
      source = AttendanceSource.QR;
      qrTokenId = qrToken.id;
    } else if (input.nfcValue) {
      if (!venue.clockInNfcEnabled) {
        throw new ForbiddenException('Timbratura tramite NFC non abilitata per questo locale');
      }
      const nfcTag = await this.prisma.nfcTag.findUnique({ where: { value: input.nfcValue } });
      if (!nfcTag || !nfcTag.active || nfcTag.venueId !== venueId) {
        throw new NotFoundException('Tag NFC non valido');
      }
      source = AttendanceSource.NFC;
      nfcTagId = nfcTag.id;
    } else if (input.gpsLat !== undefined && input.gpsLng !== undefined) {
      if (!venue.clockInGpsEnabled) {
        throw new ForbiddenException('Timbratura tramite GPS non abilitata per questo locale');
      }
      if (venue.gpsLat == null || venue.gpsLng == null) {
        throw new BadRequestException(
          "Posizione del locale non ancora configurata dall'amministratore",
        );
      }
      const distance = distanceMeters(venue.gpsLat, venue.gpsLng, input.gpsLat, input.gpsLng);
      if (distance > venue.gpsRadiusMeters) {
        throw new ForbiddenException(
          `Sei troppo lontano dal locale per timbrare (${Math.round(distance)} m, massimo ${venue.gpsRadiusMeters} m)`,
        );
      }
      source = AttendanceSource.GPS;
      gpsLat = input.gpsLat;
      gpsLng = input.gpsLng;
    } else {
      const anyMethodEnabled =
        venue.clockInQrEnabled || venue.clockInGpsEnabled || venue.clockInNfcEnabled;
      if (anyMethodEnabled) {
        throw new BadRequestException('Usa uno dei metodi di timbratura abilitati per il locale');
      }
      source = AttendanceSource.MANUAL;
    }

    const { nextAction } = await this.getCurrentStatus(user.userId);

    const record = await this.prisma.attendanceRecord.create({
      data: { employeeId, type: nextAction, source, qrTokenId, nfcTagId, gpsLat, gpsLng },
    });

    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'AttendanceRecord',
      entityId: record.id,
      action: 'CREATE',
      after: record,
    });

    return record;
  }

  /**
   * "Ho dimenticato di timbrare": il dipendente dichiara lui stesso data/ora
   * di una timbratura mancata. Resta PENDING (esclusa da stato/totali/export)
   * finché l'admin non la conferma o rifiuta.
   */
  async selfReport(user: AuthenticatedUser, dto: SelfReportAttendanceDto) {
    const venueId = requireVenueId(user);
    const employeeId = await this.resolveEmployeeId(user.userId);

    const timestamp = new Date(dto.timestamp);
    if (timestamp.getTime() > Date.now()) {
      throw new BadRequestException('Non puoi segnalare una timbratura nel futuro');
    }

    const { nextAction } = await this.getCurrentStatus(user.userId);

    const record = await this.prisma.attendanceRecord.create({
      data: {
        employeeId,
        type: nextAction,
        timestamp,
        source: AttendanceSource.SELF_REPORTED,
        approvalStatus: AttendanceApprovalStatus.PENDING,
      },
    });

    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'AttendanceRecord',
      entityId: record.id,
      action: 'CREATE',
      after: record,
    });

    return record;
  }

  // ---- Amministrazione ----------------------------------------------------

  listRecords(venueId: string, filters: { employeeId?: string; from?: string; to?: string }) {
    // "to" arriva come data (es. "2026-09-21"), interpretata da new Date()
    // come mezzanotte UTC: senza estenderla a fine giornata, "lte" escludeva
    // di fatto le timbrature dell'intera giornata da lista ed export XLS/PDF
    // (stesso bug già corretto per i report HACCP).
    const toDate = filters.to ? new Date(filters.to) : undefined;
    toDate?.setUTCHours(23, 59, 59, 999);

    return this.prisma.attendanceRecord.findMany({
      where: {
        employee: { venueId },
        employeeId: filters.employeeId,
        timestamp: {
          gte: filters.from ? new Date(filters.from) : undefined,
          lte: toDate,
        },
      },
      include: { employee: true, qrToken: true, nfcTag: true },
      orderBy: { timestamp: 'desc' },
    });
  }

  async correctRecord(admin: AuthenticatedUser, recordId: string, dto: CorrectAttendanceDto) {
    const venueId = requireVenueId(admin);
    const before = await this.prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: { employee: true },
    });
    // Verifica che la timbratura appartenga al locale di chi corregge: senza
    // questo controllo un Admin poteva riscrivere la timbratura di un altro
    // locale indovinandone l'id (stesso tipo di bug già corretto altrove).
    if (!before || before.employee.venueId !== venueId) {
      throw new NotFoundException('Timbratura non trovata');
    }

    const after = await this.prisma.attendanceRecord.update({
      where: { id: recordId },
      data: {
        timestamp: new Date(dto.timestamp),
        source: AttendanceSource.CORRECTION,
        correctedById: admin.userId,
        note: dto.reason,
      },
    });

    await this.audit.log({
      venueId,
      userId: admin.userId,
      entity: 'AttendanceRecord',
      entityId: recordId,
      action: 'UPDATE',
      before,
      after,
    });

    return after;
  }

  /**
   * Aggiunge una timbratura per conto di un dipendente (es. l'ha dimenticata):
   * solo l'admin, mai per sé stesso (l'admin non ha un Employee collegato).
   */
  async addRecord(admin: AuthenticatedUser, dto: AddAttendanceRecordDto) {
    const venueId = requireVenueId(admin);
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee || employee.venueId !== venueId) {
      throw new NotFoundException('Dipendente non trovato');
    }

    const record = await this.prisma.attendanceRecord.create({
      data: {
        employeeId: dto.employeeId,
        type: dto.type,
        timestamp: new Date(dto.timestamp),
        source: AttendanceSource.CORRECTION,
        correctedById: admin.userId,
        note: dto.note,
      },
    });

    await this.audit.log({
      venueId,
      userId: admin.userId,
      entity: 'AttendanceRecord',
      entityId: record.id,
      action: 'CREATE',
      after: record,
    });

    return record;
  }

  async deleteRecord(admin: AuthenticatedUser, recordId: string) {
    const venueId = requireVenueId(admin);
    const before = await this.prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: { employee: true },
    });
    if (!before || before.employee.venueId !== venueId) {
      throw new NotFoundException('Timbratura non trovata');
    }

    await this.prisma.attendanceRecord.delete({ where: { id: recordId } });

    await this.audit.log({
      venueId,
      userId: admin.userId,
      entity: 'AttendanceRecord',
      entityId: recordId,
      action: 'DELETE',
      before,
    });

    return { success: true };
  }

  /** Timbrature "ho dimenticato di timbrare" in attesa di conferma admin. */
  listPending(venueId: string) {
    return this.prisma.attendanceRecord.findMany({
      where: { employee: { venueId }, approvalStatus: AttendanceApprovalStatus.PENDING },
      include: { employee: true },
      orderBy: { timestamp: 'asc' },
    });
  }

  async reviewSelfReport(admin: AuthenticatedUser, recordId: string, approve: boolean) {
    const venueId = requireVenueId(admin);
    const before = await this.prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: { employee: true },
    });
    if (!before || before.employee.venueId !== venueId) {
      throw new NotFoundException('Timbratura non trovata');
    }
    if (before.approvalStatus !== AttendanceApprovalStatus.PENDING) {
      throw new BadRequestException('Questa timbratura è già stata revisionata');
    }

    const after = await this.prisma.attendanceRecord.update({
      where: { id: recordId },
      data: {
        approvalStatus: approve
          ? AttendanceApprovalStatus.CONFIRMED
          : AttendanceApprovalStatus.REJECTED,
        reviewedById: admin.userId,
      },
    });

    await this.audit.log({
      venueId,
      userId: admin.userId,
      entity: 'AttendanceRecord',
      entityId: recordId,
      action: 'UPDATE',
      before,
      after,
    });

    return after;
  }
}
