import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * "Il mio profilo": qualunque utente autenticato (Admin, Manager,
 * Dipendente, anche Super Admin) gestisce da sé i propri dati e la
 * propria password, senza passare dall'admin del locale — a differenza
 * di `UsersService`, che è l'admin che agisce su UN ALTRO account
 * (dipendenti). Qui si agisce sempre e solo sul proprio `userId` (dal
 * token), non serve alcun controllo di ownership sul locale.
 */
@Injectable()
export class MeService {
  constructor(private prisma: PrismaService) {}

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { employee: { select: { firstName: true, lastName: true, phone: true } } },
    });
    if (!user) throw new NotFoundException('Utente non trovato');
    return user;
  }

  async getOwnProfile(userId: string) {
    const user = await this.requireUser(userId);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.employee?.firstName ?? null,
      lastName: user.employee?.lastName ?? null,
      phone: user.employee?.phone ?? null,
    };
  }

  async updateOwnProfile(userId: string, dto: UpdateMeDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { employee: true } });
    if (!user) throw new NotFoundException('Utente non trovato');

    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing) throw new ConflictException('Esiste già un account con questa email');
      await this.prisma.user.update({ where: { id: userId }, data: { email: dto.email } });
    }

    // firstName/lastName/phone esistono solo su Employee: senza uno
    // collegato (tipicamente l'Admin creato alla provisioning del
    // locale) questi campi vengono semplicemente ignorati, non è un
    // errore — non c'è altro posto dove salvarli.
    if (user.employee && (dto.firstName !== undefined || dto.lastName !== undefined || dto.phone !== undefined)) {
      await this.prisma.employee.update({
        where: { id: user.employee.id },
        data: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        },
      });
    }

    return this.getOwnProfile(userId);
  }

  async changeOwnPassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.requireUser(userId);
    const currentOk = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!currentOk) {
      throw new UnauthorizedException('Password attuale non corretta');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('La nuova password deve essere diversa da quella attuale');
    }
    const passwordHash = await AuthService.hashPassword(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { success: true };
  }
}
