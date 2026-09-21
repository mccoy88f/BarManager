import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface AuditParams {
  venueId: string;
  userId: string;
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  before?: unknown;
  after?: unknown;
}

/**
 * Traccia in modo immutabile ogni operazione sensibile (presenze, HACCP,
 * ordini) richiesta ai fini di audit/contestazioni e ispezioni.
 */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: AuditParams): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        venueId: params.venueId,
        userId: params.userId,
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        before: params.before as any,
        after: params.after as any,
      },
    });
  }
}
