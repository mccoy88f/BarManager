import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { minutesOfDayInZone } from '../common/timezone/timezone';
import { LoyverseSyncService } from './loyverse-sync.service';

/** Orari locali (minuti dalla mezzanotte) in cui lanciare il sync automatico. */
const AUTO_SYNC_MINUTES = new Set([6 * 60, 18 * 60]);

/**
 * Con l'integrazione Loyverse attiva, sincronizza automaticamente il menù
 * ogni giorno alle 06:00 e alle 18:00 nel fuso orario del locale.
 */
@Injectable()
export class LoyverseSyncSchedulerService {
  private readonly logger = new Logger(LoyverseSyncSchedulerService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private syncService: LoyverseSyncService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick() {
    if (this.running) {
      this.logger.warn('Sync automatica Loyverse ancora in corso: salto questo giro.');
      return;
    }

    const now = new Date();
    const venues = await this.prisma.venue.findMany({
      where: {
        loyverseIntegrationEnabled: true,
        loyverseAccessTokenEnc: { not: null },
      },
      select: { id: true, name: true, timezone: true },
    });

    const due = venues.filter((v) => AUTO_SYNC_MINUTES.has(minutesOfDayInZone(now, v.timezone)));
    if (due.length === 0) return;

    this.running = true;
    try {
      for (const venue of due) {
        try {
          const summary = await this.syncService.sync(venue.id);
          this.logger.log(
            `Sync automatica Loyverse completata per "${venue.name}" (${venue.id}): ` +
              `${summary.categories} categorie, ${summary.items} voci.`,
          );
        } catch (err) {
          this.logger.error(
            `Sync automatica Loyverse fallita per "${venue.name}" (${venue.id}): ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
