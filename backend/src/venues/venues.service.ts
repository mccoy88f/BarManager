import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { resolveOpeningHours } from '../common/opening-hours/opening-hours';
import { encryptSecret, decryptSecret } from '../common/crypto/secret-crypto';
import { sumupClient } from '../common/payments/sumup-client';
import { loyverseClient } from '../loyverse/loyverse-client';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { UpdateOpeningHoursDto } from './dto/update-opening-hours.dto';
import { UpdateClockInSettingsDto } from './dto/update-clock-in-settings.dto';
import { UpdateMenuSettingsDto } from './dto/update-menu-settings.dto';
import { UpdateAttendanceHistorySettingsDto } from './dto/update-attendance-history-settings.dto';
import { UpdateReservationSettingsDto } from './dto/update-reservation-settings.dto';
import { UpdateOnlineOrdersSettingsDto } from './dto/update-online-orders-settings.dto';
import { UpdateSumUpSettingsDto } from './dto/update-sumup-settings.dto';
import { UpdateSumUpPaymentMethodsDto } from './dto/update-sumup-payment-methods.dto';

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
        city: true,
        vatNumber: true,
        timezone: true,
        themeAccentColor: true,
        reservationsEnabled: true,
        reservationAutoConfirmMaxSeats: true,
        reservationSlotDurationMinutes: true,
        reservationHorizonDays: true,
        reservationOverbookingUnlimited: true,
        reservationOverbookingExtraSeats: true,
        reservationMinLeadMinutes: true,
        onlineOrdersEnabled: true,
        onlineOrdersPickupEnabled: true,
        onlineOrdersDeliveryEnabled: true,
        onlineOrdersOpeningHours: true,
        onlineOrdersMinLeadMinutes: true,
        onlineOrdersAutoAcceptEnabled: true,
        onlineOrdersAutoAcceptSlotMode: true,
        onlineOrdersAutoAcceptPerSlot: true,
        onlineOrdersAutoAcceptPerSlotPickup: true,
        onlineOrdersAutoAcceptPerSlotDelivery: true,
        deliveryRadiusMeters: true,
        deliveryFee: true,
        deliveryFreeAboveAmount: true,
        sumupEnabled: true,
        sumupEnabledPaymentMethods: true,
        loyverseSyncOnlineOrders: true,
        loyversePaymentTypeIdCash: true,
        loyversePaymentTypeIdCardOnline: true,
        loyversePaymentTypeIdCardInStore: true,
      },
    });
    if (!venue) return venue;
    return {
      ...venue,
      openingHours: resolveOpeningHours(venue.openingHours),
      onlineOrdersOpeningHours: venue.onlineOrdersOpeningHours
        ? resolveOpeningHours(venue.onlineOrdersOpeningHours)
        : null,
      sumupHasApiKey: !!(venue as { sumupApiKeyEnc?: string | null }).sumupApiKeyEnc,
    };
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

  updateOnlineOrdersSettings(venueId: string, dto: UpdateOnlineOrdersSettingsDto) {
    return this.prisma.venue.update({ where: { id: venueId }, data: dto });
  }

  async updateOnlineOrdersOpeningHours(venueId: string, dto: UpdateOpeningHoursDto) {
    await this.prisma.venue.update({
      where: { id: venueId },
      data: { onlineOrdersOpeningHours: dto.days as object },
    });
    return { onlineOrdersOpeningHours: dto.days };
  }

  async updateSumUpSettings(venueId: string, dto: UpdateSumUpSettingsDto) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Locale non trovato');

    const data: { sumupApiKeyEnc?: string | null; sumupEnabled?: boolean } = {};
    if (dto.apiKey !== undefined) {
      data.sumupApiKeyEnc = dto.apiKey ? encryptSecret(dto.apiKey) : null;
    }
    if (dto.enabled !== undefined) {
      const willHaveKey = dto.apiKey ? true : !!venue.sumupApiKeyEnc;
      if (dto.enabled && !willHaveKey) {
        throw new BadRequestException('Imposta prima una API key SumUp valida.');
      }
      data.sumupEnabled = dto.enabled;
    }
    await this.prisma.venue.update({ where: { id: venueId }, data });
    return { enabled: data.sumupEnabled ?? venue.sumupEnabled, hasApiKey: !!(data.sumupApiKeyEnc ?? venue.sumupApiKeyEnc) };
  }

  /**
   * Crea un checkout SumUp minimo usa e getta solo per interrogare i
   * metodi di pagamento davvero disponibili per l'account (§5.10): non
   * viene mai pagato né mostrato al cliente, serve solo a leggere
   * l'elenco che l'admin poi filtra in "abilitati".
   */
  async verifySumUpPaymentMethods(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue?.sumupApiKeyEnc) {
      throw new BadRequestException('Imposta prima una API key SumUp valida.');
    }
    const apiKey = decryptSecret(venue.sumupApiKeyEnc);
    const checkout = await sumupClient.createCheckout(apiKey, {
      checkoutReference: `verify-${venueId}-${Date.now()}`,
      amount: 1,
      currency: 'EUR',
      description: 'Verifica metodi di pagamento disponibili',
    });
    return sumupClient.getAvailablePaymentMethods(apiKey, checkout.id);
  }

  updateSumUpPaymentMethods(venueId: string, dto: UpdateSumUpPaymentMethodsDto) {
    return this.prisma.venue.update({
      where: { id: venueId },
      data: { sumupEnabledPaymentMethods: dto.methods },
    });
  }

  /** Metodi di pagamento configurati dal locale nel proprio Back Office Loyverse, per la mappatura in Impostazioni (§5.10). */
  async listLoyversePaymentTypes(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue?.loyverseAccessTokenEnc) {
      throw new BadRequestException('Integrazione Loyverse non configurata.');
    }
    return loyverseClient.listPaymentTypes(decryptSecret(venue.loyverseAccessTokenEnc));
  }
}
