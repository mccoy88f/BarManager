import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueHoursDto } from './dto/update-venue-hours.dto';

/**
 * Gestione locali riservata al Super Admin: creazione del Venue e del suo
 * primo account Admin in un'unica operazione, sospensione locale.
 */
@Injectable()
export class VenuesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateVenueDto) {
    const existing = await this.prisma.venue.findUnique({ where: { slug: dto.slug } });
    if (existing) {
      throw new BadRequestException('Sotto-dominio già in uso');
    }

    const passwordHash = await AuthService.hashPassword(dto.adminPassword);

    return this.prisma.venue.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        users: {
          create: {
            email: dto.adminEmail,
            passwordHash,
            role: Role.ADMIN,
          },
        },
      },
      include: { users: { select: { id: true, email: true, role: true } } },
    });
  }

  listAll() {
    return this.prisma.venue.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true } } },
    });
  }

  setActive(venueId: string, active: boolean) {
    return this.prisma.venue.update({ where: { id: venueId }, data: { active } });
  }

  getOwn(venueId: string) {
    return this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        name: true,
        slug: true,
        lunchStart: true,
        lunchEnd: true,
        dinnerStart: true,
        dinnerEnd: true,
      },
    });
  }

  updateHours(venueId: string, dto: UpdateVenueHoursDto) {
    return this.prisma.venue.update({ where: { id: venueId }, data: dto });
  }
}
