import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { resolveOpeningHours } from '../common/opening-hours/opening-hours';
import { encryptSecret, decryptSecret } from '../common/crypto/secret-crypto';
import { SumUpApiError, sumupClient } from '../common/payments/sumup-client';
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
import { UpsertSpecialDayDto } from './dto/upsert-special-day.dto';
import { specialDayKey } from '../common/opening-hours/opening-hours';

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
        menuMealPeriodsHours: true,
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
        onlineOrdersMinOrderAmount: true,
        onlineOrdersAutoAcceptEnabled: true,
        onlineOrdersAutoAcceptSlotMode: true,
        onlineOrdersAutoAcceptPerSlot: true,
        onlineOrdersAutoAcceptPerSlotPickup: true,
        onlineOrdersAutoAcceptPerSlotDelivery: true,
        deliveryRadiusMeters: true,
        deliveryFee: true,
        deliveryFreeAboveAmount: true,
        sumupEnabled: true,
        sumupApiKeyEnc: true,
        loyverseIntegrationEnabled: true,
        loyversePaymentTypeIdCash: true,
        loyversePaymentTypeIdCardOnline: true,
        loyversePaymentTypeIdCardInStore: true,
      },
    });
    if (!venue) return venue;
    // sumupApiKeyEnc va selezionato per sapere se una chiave è già
    // impostata, ma è una credenziale cifrata: non deve mai lasciare il
    // backend, nemmeno cifrata — va escluso dallo spread, non solo
    // "letto" per il booleano sumupHasApiKey qui sotto.
    const { sumupApiKeyEnc, ...venueWithoutSecrets } = venue;
    return {
      ...venueWithoutSecrets,
      openingHours: resolveOpeningHours(venue.openingHours),
      menuMealPeriodsHours: resolveOpeningHours(venue.menuMealPeriodsHours),
      onlineOrdersOpeningHours: venue.onlineOrdersOpeningHours
        ? resolveOpeningHours(venue.onlineOrdersOpeningHours)
        : null,
      sumupHasApiKey: !!sumupApiKeyEnc,
    };
  }

  updateOpeningHours(venueId: string, dto: UpdateOpeningHoursDto) {
    return this.prisma.venue.update({ where: { id: venueId }, data: { openingHours: dto.days as object } });
  }

  /** Fasce pranzo/cena del MENÙ (§5.10), decoupled dall'orario reale sopra. */
  updateMenuHours(venueId: string, dto: UpdateOpeningHoursDto) {
    return this.prisma.venue.update({
      where: { id: venueId },
      data: { menuMealPeriodsHours: dto.days as object },
    });
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

  async resetOnlineOrdersOpeningHours(venueId: string) {
    await this.prisma.venue.update({
      where: { id: venueId },
      data: { onlineOrdersOpeningHours: Prisma.DbNull },
    });
    return { onlineOrdersOpeningHours: null };
  }

  async updateSumUpSettings(venueId: string, dto: UpdateSumUpSettingsDto) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Locale non trovato');

    // Sanificazione difensiva: il campo è type="password" (valore mascherato,
    // l'admin non può accorgersi a occhio di spazi/a capo incollati per
    // errore) e le pagine SumUp mostrano la chiave dentro esempi come
    // "Authorization: Bearer sup_sk_...", da cui capita di copiare anche la
    // parola "Bearer" insieme alla chiave — in entrambi i casi la chiamata a
    // SumUp fallirebbe con 401 pur avendo la chiave "giusta".
    const sanitizedApiKey = dto.apiKey?.trim().replace(/^bearer\s+/i, '') || null;
    const data: { sumupApiKeyEnc?: string | null; sumupEnabled?: boolean } = {};
    if (dto.apiKey !== undefined) {
      data.sumupApiKeyEnc = sanitizedApiKey ? encryptSecret(sanitizedApiKey) : null;
    }
    if (dto.enabled !== undefined) {
      const willHaveKey = sanitizedApiKey ? true : !!venue.sumupApiKeyEnc;
      if (dto.enabled && !willHaveKey) {
        throw new BadRequestException('Imposta prima una API key SumUp valida.');
      }
      data.sumupEnabled = dto.enabled;
    }
    await this.prisma.venue.update({ where: { id: venueId }, data });
    return { enabled: data.sumupEnabled ?? venue.sumupEnabled, hasApiKey: !!(data.sumupApiKeyEnc ?? venue.sumupApiKeyEnc) };
  }

  /**
   * Verifica solo che la API key SumUp funzioni (nessun checkout creato,
   * §5.10): non serviva sapere quali metodi di pagamento sono disponibili,
   * dato che il checkout reale non li filtra comunque per metodo.
   */
  async verifySumUpApiKey(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue?.sumupApiKeyEnc) {
      throw new BadRequestException('Imposta prima una API key SumUp valida.');
    }
    const apiKey = decryptSecret(venue.sumupApiKeyEnc);
    // SumUpApiError non è una HttpException di NestJS: senza tradurla qui,
    // un errore SumUp (es. API key non valida, 401) risalirebbe come 500
    // Internal Server Error generico invece di un 400 con un messaggio
    // leggibile per l'admin.
    try {
      await sumupClient.verifyApiKey(apiKey);
      return { valid: true };
    } catch (err) {
      if (err instanceof SumUpApiError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /**
   * Aperture speciali (§5.10 di DEVELOPMENT.md): sovrascrivono per una
   * singola data l'orario reale e/o gli orari pranzo/cena del menù.
   */
  listSpecialDays(venueId: string) {
    return this.prisma.venueSpecialDay.findMany({ where: { venueId }, orderBy: { date: 'asc' } });
  }

  upsertSpecialDay(venueId: string, dto: UpsertSpecialDayDto) {
    const date = specialDayKey(dto.date);
    // I campi Json? nullable di Prisma non accettano un plain `null` nel
    // tipo generato (richiede Prisma.JsonNull) — il cast qui sotto è lo
    // stesso compromesso pragmatico già usato altrove nel file per i campi
    // Json (es. updateOpeningHours: "dto.days as object").
    const overrides = {
      realHoursOverride: (dto.realHoursOverride ?? null) as unknown as object,
      menuHoursOverride: (dto.menuHoursOverride ?? null) as unknown as object,
    };
    return this.prisma.venueSpecialDay.upsert({
      where: { venueId_date: { venueId, date } },
      create: { venueId, date, label: dto.label ?? null, ...overrides },
      update: { label: dto.label ?? null, ...overrides },
    });
  }

  async removeSpecialDay(venueId: string, id: string) {
    const day = await this.prisma.venueSpecialDay.findUnique({ where: { id } });
    if (!day || day.venueId !== venueId) {
      throw new NotFoundException('Apertura speciale non trovata');
    }
    await this.prisma.venueSpecialDay.delete({ where: { id } });
    return { success: true };
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
