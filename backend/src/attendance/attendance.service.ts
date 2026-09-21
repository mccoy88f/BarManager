import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceSource, AttendanceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';

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
    return this.prisma.qrToken.findMany({ where: { venueId } });
  }

  // ---- Timbratura -------------------------------------------------------

  /** Stato corrente del dipendente loggato: cosa può fare (inizio/fine). */
  async getCurrentStatus(userId: string) {
    const employeeId = await this.resolveEmployeeId(userId);
    const last = await this.prisma.attendanceRecord.findFirst({
      where: { employeeId },
      orderBy: { timestamp: 'desc' },
    });
    const nextAction: AttendanceType =
      !last || last.type === AttendanceType.CLOCK_OUT
        ? AttendanceType.CLOCK_IN
        : AttendanceType.CLOCK_OUT;
    return { lastRecord: last, nextAction };
  }

  /**
   * Timbra inizio/fine turno. Con qrTokenValue: postazione fisica (source
   * QR, anti-frode). Senza: timbratura diretta dall'app per il dipendente
   * già loggato (source MANUAL) — utile quando non c'è un QR a portata di
   * mano, es. da smartphone personale o in fase di test.
   */
  async clock(user: AuthenticatedUser, qrTokenValue?: string) {
    const venueId = requireVenueId(user);
    const employeeId = await this.resolveEmployeeId(user.userId);

    const qrToken = qrTokenValue
      ? await this.prisma.qrToken.findUnique({ where: { token: qrTokenValue } })
      : null;
    if (qrTokenValue && (!qrToken || !qrToken.active || qrToken.venueId !== venueId)) {
      throw new NotFoundException('QR non valido');
    }

    const { nextAction } = await this.getCurrentStatus(user.userId);

    const record = await this.prisma.attendanceRecord.create({
      data: {
        employeeId,
        type: nextAction,
        source: qrToken ? AttendanceSource.QR : AttendanceSource.MANUAL,
        qrTokenId: qrToken?.id,
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
      include: { employee: true },
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
}
