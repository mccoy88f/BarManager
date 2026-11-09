import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Endpoint di liveness/readiness per l'healthcheck Docker (nessuna auth:
 * deve rispondere prima che un utente possa loggarsi). Verifica anche la
 * connessione al database: se Postgres non è raggiungibile, il container
 * va segnalato "unhealthy" invece di restare silenziosamente rotto.
 */
@Controller('health')
export class HealthController {
  private static readonly GITHUB_LATEST =
    'https://api.github.com/repos/mccoy88f/BarManager/releases/latest';
  private static readonly CACHE_MS = 5 * 60 * 1000;

  private cachedRelease: { version: string; at: number } | null = null;

  constructor(private prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database non raggiungibile');
    }
    return { status: 'ok' };
  }

  /**
   * Versione piattaforma = tag dell'ultima GitHub Release (stesso numero
   * degli APK). Così il menu laterale del sito resta allineato anche se il
   * frontend statico non è ancora stato ricostruito dopo un release.
   */
  @Get('version')
  async version() {
    const now = Date.now();
    if (this.cachedRelease && now - this.cachedRelease.at < HealthController.CACHE_MS) {
      return { version: this.cachedRelease.version };
    }
    try {
      const res = await fetch(HealthController.GITHUB_LATEST, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'BarManager',
        },
      });
      if (res.ok) {
        const data = (await res.json()) as { tag_name?: string };
        const tag = data.tag_name?.trim();
        if (tag) {
          this.cachedRelease = { version: tag, at: now };
          return { version: tag };
        }
      }
    } catch {
      // Rete/GitHub non raggiungibili: fallback sotto.
    }
    if (this.cachedRelease) return { version: this.cachedRelease.version };
    return { version: process.env.APP_VERSION ?? 'unknown' };
  }
}
