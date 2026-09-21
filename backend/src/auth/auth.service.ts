import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

/** Contesto di tenant risolto dal TenantMiddleware in base al sotto-dominio. */
export interface LoginContext {
  venue?: { id: string; slug: string } | null;
  isAdminHost?: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string, context: LoginContext = {}) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Credenziali non valide');
    }

    const passwordOk = await argon2.verify(user.passwordHash, password);
    if (!passwordOk) {
      throw new UnauthorizedException('Credenziali non valide');
    }

    this.assertHostMatchesUser(user, context);

    // Solo per Manager/Dipendente: i permessi per modulo (§ ModuleAccessGuard)
    // finiscono nel payload così il frontend può filtrare la navigazione
    // senza una chiamata aggiuntiva — l'autorità resta comunque lato server,
    // verificata ad ogni richiesta dal guard.
    let allowedModules: string[] | undefined;
    if (user.role === Role.MANAGER || user.role === Role.EMPLOYEE) {
      const employee = await this.prisma.employee.findUnique({
        where: { userId: user.id },
        select: { allowedModules: true },
      });
      allowedModules = employee?.allowedModules ?? [];
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      venueId: user.venueId,
      ...(allowedModules !== undefined ? { allowedModules } : {}),
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET || 'dev-secret',
      expiresIn: process.env.JWT_ACCESS_TTL || '15m',
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
      expiresIn: process.env.JWT_REFRESH_TTL || '7d',
    });

    const venueName = user.venueId
      ? (await this.prisma.venue.findUnique({ where: { id: user.venueId }, select: { name: true } }))
          ?.name ?? null
      : null;

    return { accessToken, refreshToken, user: payload, venueName };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
      });
      delete payload.iat;
      delete payload.exp;

      const accessToken = await this.jwt.signAsync(payload, {
        secret: process.env.JWT_ACCESS_SECRET || 'dev-secret',
        expiresIn: process.env.JWT_ACCESS_TTL || '15m',
      });
      return { accessToken };
    } catch {
      throw new UnauthorizedException('Refresh token non valido o scaduto');
    }
  }

  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  /**
   * Verifica la coerenza fra il sotto-dominio da cui si accede e l'utente:
   * - host di amministrazione → solo SUPER_ADMIN;
   * - sotto-dominio di un locale → solo utenti di quel locale (il SUPER_ADMIN
   *   può comunque autenticarsi ovunque, per supporto);
   * - nessun contesto risolto (sviluppo locale senza sotto-domini) → nessun
   *   controllo, per non complicare lo sviluppo in locale.
   */
  private assertHostMatchesUser(user: { role: Role; venueId: string | null }, context: LoginContext) {
    if (context.isAdminHost) {
      if (user.role !== Role.SUPER_ADMIN) {
        throw new UnauthorizedException(
          'Accedi dal sotto-dominio del tuo locale, non da quello di amministrazione',
        );
      }
      return;
    }

    if (context.venue) {
      if (user.role !== Role.SUPER_ADMIN && user.venueId !== context.venue.id) {
        throw new UnauthorizedException('Utente non abilitato per questo locale');
      }
    }
  }
}
