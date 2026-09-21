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

  async clock(user: AuthenticatedUser, qrTokenValue: string) {
    const venueId = requireVenueId(user);
    const employeeId = await this.resolveEmployeeId(user.userId);

    const qrToken = await this.prisma.qrToken.findUnique({ where: { token: qrTokenValue } });
    if (!qrToken || !qrToken.active || qrToken.venueId !== venueId) {
      throw new NotFoundException('QR non valido');
    }

    const { nextAction } = await this.getCurrentStatus(user.userId);

    const record = await this.prisma.attendanceRecord.create({
      data: {
        employeeId,
        type: nextAction,
        source: AttendanceSource.QR,
        qrTokenId: qrToken.id,
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
    return this.prisma.attendanceRecord.findMany({
      where: {
        employee: { venueId },
        employeeId: filters.employeeId,
        timestamp: {
          gte: filters.from ? new Date(filters.from) : undefined,
          lte: filters.to ? new Date(filters.to) : undefined,
        },
      },
      include: { employee: true },
      orderBy: { timestamp: 'desc' },
    });
  }

  async correctRecord(admin: AuthenticatedUser, recordId: string, dto: CorrectAttendanceDto) {
    const before = await this.prisma.attendanceRecord.findUnique({ where: { id: recordId } });
    if (!before) throw new NotFoundException('Timbratura non trovata');

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
      venueId: requireVenueId(admin),
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
