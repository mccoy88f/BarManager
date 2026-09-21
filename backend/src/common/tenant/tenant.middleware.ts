import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

declare module 'express-serve-static-core' {
  interface Request {
    /** Locale risolto dal sotto-dominio (solo se il sotto-dominio combacia con un Venue.slug attivo). */
    venue?: { id: string; slug: string } | null;
    /** true se la richiesta arriva dal sotto-dominio riservato al Super Admin. */
    isAdminHost?: boolean;
  }
}

/**
 * Risolve il "tenant" (locale) dalla richiesta in base al sotto-dominio,
 * usato principalmente dal menù pubblico (nessun login) e per validare,
 * al login, che l'utente stia accedendo dal sotto-dominio del proprio locale.
 *
 * In sviluppo locale (ROOT_DOMAIN non configurato) il middleware è no-op:
 * non blocca nulla, req.venue/isAdminHost restano undefined.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const rootDomain = process.env.ROOT_DOMAIN;
    if (!rootDomain) {
      return next();
    }

    const hostname = req.hostname; // Express: Host header senza porta
    const adminSubdomain = process.env.ADMIN_SUBDOMAIN || 'admin';

    if (hostname === `${adminSubdomain}.${rootDomain}`) {
      req.isAdminHost = true;
      return next();
    }

    if (hostname.endsWith(`.${rootDomain}`)) {
      const slug = hostname.slice(0, -(rootDomain.length + 1));
      req.venue = await this.prisma.venue.findFirst({
        where: { slug, active: true },
        select: { id: true, slug: true },
      });
    }

    next();
  }
}
