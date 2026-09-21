import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Credenziali non valide');
    }

    const passwordOk = await argon2.verify(user.passwordHash, password);
    if (!passwordOk) {
      throw new UnauthorizedException('Credenziali non valide');
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      venueId: user.venueId,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET || 'dev-secret',
      expiresIn: process.env.JWT_ACCESS_TTL || '15m',
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
      expiresIn: process.env.JWT_REFRESH_TTL || '7d',
    });

    return { accessToken, refreshToken, user: payload };
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
}
