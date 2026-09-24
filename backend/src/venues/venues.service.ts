import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { resolveOpeningHours } from '../common/opening-hours/opening-hours';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { UpdateOpeningHoursDto } from './dto/update-opening-hours.dto';
import { UpdateClockInSettingsDto } from './dto/update-clock-in-settings.dto';
import { UpdateMenuSettingsDto } from './dto/update-menu-settings.dto';
import { UpdateAttendanceHistorySettingsDto } from './dto/update-attendance-history-settings.dto';
import { UpdateReservationSettingsDto } from './dto/update-reservation-settings.dto';

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

  async update(venueId: string, dto: UpdateVenueDto) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) {
      throw new NotFoundException('Locale non trovato');
    }
    if (dto.slug && dto.slug !== venue.slug) {
      const existing = await this.prisma.venue.findUnique({ where: { slug: dto.slug } });
      if (existing) {
        throw new BadRequestException('Sotto-dominio già in uso');
      }
    }
    return this.prisma.venue.update({ where: { id: venueId }, data: dto });
  }

  async getOwn(venueId: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        openingHours: true,
        clockInQrEnabled: true,
        clockInGpsEnabled: true,
        clockInNfcEnabled: true,
        gpsLat: true,
        gpsLng: true,
        attendanceHistoryVisibleToEmployees: true,
        attendanceRetentionValue: true,
        attendanceRetentionUnit: true,
        gpsRadiusMeters: true,
        menuCoverUrl: true,
        logoUrl: true,
        menuAddress: true,
        menuPhone: true,
        menuInstagramUrl: true,
        menuFacebookUrl: true,
        menuWebsiteUrl: true,
        reservationsEnabled: true,
        reservationAutoConfirmMaxSeats: true,
        reservationSlotDurationMinutes: true,
        reservationHorizonDays: true,
        reservationOverbookingUnlimited: true,
        reservationOverbookingExtraSeats: true,
      },
    });
    if (!venue) return venue;
    return { ...venue, openingHours: resolveOpeningHours(venue.openingHours) };
  }

  updateOpeningHours(venueId: string, dto: UpdateOpeningHoursDto) {
    return this.prisma.venue.update({ where: { id: venueId }, data: { openingHours: dto.days as object } });
  }

  updateClockInSettings(venueId: string, dto: UpdateClockInSettingsDto) {
    return this.prisma.venue.update({ where: { id: venueId }, data: dto });
  }

  updateAttendanceHistorySettings(venueId: string, dto: UpdateAttendanceHistorySettingsDto) {
    return this.prisma.venue.update({ where: { id: venueId }, data: dto });
  }

  updateMenuSettings(venueId: string, dto: UpdateMenuSettingsDto) {
    return this.prisma.venue.update({ where: { id: venueId }, data: dto });
  }

  setMenuCover(venueId: string, menuCoverUrl: string) {
    return this.prisma.venue.update({ where: { id: venueId }, data: { menuCoverUrl } });
  }

  setLogo(venueId: string, logoUrl: string) {
    return this.prisma.venue.update({ where: { id: venueId }, data: { logoUrl } });
  }

  updateReservationSettings(venueId: string, dto: UpdateReservationSettingsDto) {
    return this.prisma.venue.update({ where: { id: venueId }, data: dto });
  }
}
