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
}
