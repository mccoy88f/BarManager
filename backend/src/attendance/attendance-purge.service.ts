import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AttendanceRetentionUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cancellazione automatica delle presenze più vecchie della soglia
 * impostata dall'admin per il locale (Impostazioni > Presenze):
 * opzionale, nessun locale la applica finché non imposta un valore.
 */
@Injectable()
export class AttendancePurgeService {
  private readonly logger = new Logger(AttendancePurgeService.name);

  constructor(private prisma: PrismaService) {}

  private cutoffDate(value: number, unit: AttendanceRetentionUnit): Date {
    const cutoff = new Date();
    if (unit === AttendanceRetentionUnit.DAYS) cutoff.setDate(cutoff.getDate() - value);
    else if (unit === AttendanceRetentionUnit.MONTHS) cutoff.setMonth(cutoff.getMonth() - value);
    else cutoff.setFullYear(cutoff.getFullYear() - value);
    return cutoff;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldRecords() {
    const venues = await this.prisma.venue.findMany({
      where: { attendanceRetentionValue: { not: null }, attendanceRetentionUnit: { not: null } },
      select: { id: true, attendanceRetentionValue: true, attendanceRetentionUnit: true },
    });

    for (const venue of venues) {
      const cutoff = this.cutoffDate(venue.attendanceRetentionValue!, venue.attendanceRetentionUnit!);
      const { count } = await this.prisma.attendanceRecord.deleteMany({
        where: { employee: { venueId: venue.id }, timestamp: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(`Cancellate ${count} presenze antecedenti al ${cutoff.toISOString()} per venue=${venue.id}`);
      }
    }
  }
}
