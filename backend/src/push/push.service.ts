import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { canManageModule, managesAttendance } from './push-audience';

const PLATFORM_ID = 'platform';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@barmanager.local';

interface PushPayload {
  title: string;
  body: string;
  url: string;
}

interface StaffUser {
  id: string;
  role: string;
  employee: { allowedModules: string[] } | null;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private ready = false;
  /** APK in attesa sulla coda: si svegliano appena arriva un evento per quel utente. */
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.ensureVapid();
      this.ready = true;
    } catch (err) {
      this.logger.error(`Push non avviato: ${(err as Error).message}`);
    }
  }

  async vapidPublicKey(): Promise<string> {
    const row = await this.ensureVapid();
    return row.vapidPublicKey;
  }

  async registerWeb(userId: string, subscription: { endpoint: string; p256dh: string; auth: string }) {
    const existing = await this.prisma.pushDevice.findUnique({ where: { endpoint: subscription.endpoint } });
    if (existing) {
      return this.prisma.pushDevice.update({
        where: { id: existing.id },
        data: {
          userId,
          kind: 'WEB',
          p256dh: subscription.p256dh,
          auth: subscription.auth,
          lastSeenAt: new Date(),
        },
      });
    }
    return this.prisma.pushDevice.create({
      data: {
        userId,
        kind: 'WEB',
        token: randomBytes(32).toString('hex'),
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        lastSeenAt: new Date(),
      },
    });
  }

  async registerAndroid(userId: string, token?: string) {
    if (token) {
      const existing = await this.prisma.pushDevice.findUnique({ where: { token } });
      if (existing && existing.userId === userId && existing.kind === 'ANDROID') {
        await this.prisma.pushDevice.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
        return { token: existing.token };
      }
    }
    const created = await this.prisma.pushDevice.create({
      data: { userId, kind: 'ANDROID', token: randomBytes(32).toString('hex'), lastSeenAt: new Date() },
    });
    return { token: created.token };
  }

  async feed(token: string | undefined, since: string | undefined, wait?: string) {
    if (!token) throw new UnauthorizedException('Dispositivo non riconosciuto');
    const device = await this.prisma.pushDevice.findUnique({ where: { token } });
    if (!device || device.kind !== 'ANDROID') throw new UnauthorizedException('Dispositivo non riconosciuto');
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 60_000);
    const after = Number.isNaN(sinceDate.getTime()) ? new Date(Date.now() - 60_000) : sinceDate;
    const waitSeconds = Math.min(Math.max(Number(wait) || 0, 0), 25);
    let events = await this.eventsSince(device.userId, after);
    if (events.length === 0 && waitSeconds > 0) {
      await this.waitForUser(device.userId, waitSeconds * 1000);
      events = await this.eventsSince(device.userId, after);
    }
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 5 * 60 * 1000) {
      await this.prisma.pushDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    }
    return {
      now: new Date().toISOString(),
      events: events.map((event) => ({
        id: event.id,
        title: event.title,
        body: event.body,
        url: event.url,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  private eventsSince(userId: string, after: Date) {
    return this.prisma.pushEvent.findMany({
      where: { userId, createdAt: { gt: after } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
  }

  private waitForUser(userId: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const set = this.waiters.get(userId);
        set?.delete(finish);
        if (set && set.size === 0) this.waiters.delete(userId);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      const set = this.waiters.get(userId) ?? new Set<() => void>();
      set.add(finish);
      this.waiters.set(userId, set);
    });
  }

  private wake(userId: string) {
    const set = this.waiters.get(userId);
    if (!set) return;
    this.waiters.delete(userId);
    for (const finish of set) finish();
  }

  reservations(venueId: string, confirmed: boolean, body: string) {
    return this.sendToVenue(venueId, 'reservations', {
      title: confirmed ? 'Prenotazione confermata' : 'Prenotazione da confermare',
      body,
      url: '/reservations',
    });
  }

  onlineOrders(venueId: string, confirmed: boolean, body: string) {
    return this.sendToVenue(venueId, 'onlineOrders', {
      title: confirmed ? 'Ordine online confermato' : 'Ordine online da confermare',
      body,
      url: '/online-orders',
    });
  }

  /** Ferie, permesso o malattia: solo Admin e Responsabile (gestiscono le timbrature). */
  leaveRequest(venueId: string, body: string) {
    return this.sendToAttendance(venueId, {
      title: 'Richiesta di permesso',
      body,
      url: '/attendance/leave-requests',
    });
  }

  private async sendToVenue(venueId: string, module: 'reservations' | 'onlineOrders', payload: PushPayload) {
    try {
      const users = await this.staff(venueId);
      const ids = users.filter((user) => canManageModule(user.role, user.employee?.allowedModules, module)).map((user) => user.id);
      await this.deliver(ids, payload);
    } catch (err) {
      this.logger.error(`Push ${module} non inviata: ${(err as Error).message}`);
    }
  }

  private async sendToAttendance(venueId: string, payload: PushPayload) {
    try {
      const users = await this.staff(venueId);
      const ids = users.filter((user) => managesAttendance(user.role)).map((user) => user.id);
      await this.deliver(ids, payload);
    } catch (err) {
      this.logger.error(`Push permesso non inviata: ${(err as Error).message}`);
    }
  }

  private staff(venueId: string): Promise<StaffUser[]> {
    return this.prisma.user.findMany({
      where: { venueId, active: true, role: { in: ['ADMIN', 'MANAGER', 'EMPLOYEE'] } },
      select: { id: true, role: true, employee: { select: { allowedModules: true } } },
    });
  }

  private async deliver(userIds: string[], payload: PushPayload) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0 || !this.ready) return;
    await this.prisma.pushEvent.createMany({
      data: ids.map((userId) => ({ userId, title: payload.title, body: payload.body, url: payload.url })),
    });
    for (const userId of ids) this.wake(userId);
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId: { in: ids }, kind: 'WEB', endpoint: { not: null } },
    });
    await Promise.all(
      devices.map(async (device) => {
        if (!device.endpoint || !device.p256dh || !device.auth) return;
        try {
          await webpush.sendNotification(
            { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
            JSON.stringify(payload),
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.prisma.pushDevice.delete({ where: { id: device.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`Web Push fallita: ${(err as Error).message}`);
          }
        }
      }),
    );
  }

  /** Una volta per versione GitHub: non ripete l'avviso a ogni riavvio. */
  @Cron(CronExpression.EVERY_HOUR)
  async announceAppUpdate() {
    try {
      const tag = await this.latestReleaseTag();
      if (!tag) return;
      const setting = await this.ensureVapid();
      if (!setting.lastAnnouncedAppVersion) {
        await this.prisma.platformSetting.update({
          where: { id: PLATFORM_ID },
          data: { lastAnnouncedAppVersion: tag },
        });
        return;
      }
      if (setting.lastAnnouncedAppVersion === tag) return;
      const devices = await this.prisma.pushDevice.findMany({ select: { userId: true } });
      await this.deliver(
        devices.map((device) => device.userId),
        {
          title: 'Aggiornamento BarManager',
          body: `È disponibile la versione ${tag.replace(/^v/, '')}.`,
          url: '/',
        },
      );
      await this.prisma.platformSetting.update({
        where: { id: PLATFORM_ID },
        data: { lastAnnouncedAppVersion: tag },
      });
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await this.prisma.pushEvent.deleteMany({ where: { createdAt: { lt: weekAgo } } });
    } catch (err) {
      this.logger.error(`Controllo aggiornamento non riuscito: ${(err as Error).message}`);
    }
  }

  private async latestReleaseTag(): Promise<string | null> {
    const response = await fetch('https://api.github.com/repos/mccoy88f/BarManager/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BarManager' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { tag_name?: string };
    const tag = body.tag_name?.trim();
    return tag || null;
  }

  private async ensureVapid() {
    const existing = await this.prisma.platformSetting.findUnique({ where: { id: PLATFORM_ID } });
    if (existing) {
      webpush.setVapidDetails(VAPID_SUBJECT, existing.vapidPublicKey, existing.vapidPrivateKey);
      this.ready = true;
      return existing;
    }
    const keys = webpush.generateVAPIDKeys();
    const created = await this.prisma.platformSetting.create({
      data: { id: PLATFORM_ID, vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey },
    });
    webpush.setVapidDetails(VAPID_SUBJECT, created.vapidPublicKey, created.vapidPrivateKey);
    this.ready = true;
    return created;
  }
}
