import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  OnlineOrder,
  OnlineOrderFulfillment,
  OnlineOrderLine,
  OnlineOrderLineModifier,
  OnlineOrderPaymentMethod,
  OnlineOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService, ReceiptSection } from '../reports/pdf.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  applyDayOverride,
  DayOverride,
  findOpenSlotWithMargin,
  hhmmToMinutes,
  minutesToHhmm,
  resolveOpeningHours,
  specialDayKey,
} from '../common/opening-hours/opening-hours';
import {
  addDaysInZone,
  dateAtTimeInZone,
  dateOnlyInZone,
  jsWeekdayInZone,
  minutesOfDayInZone,
} from '../common/timezone/timezone';
import { distanceMeters } from '../common/geo/geo';
import { locationIqClient } from '../common/geo/locationiq-client';
import { sumupClient } from '../common/payments/sumup-client';
import { decryptSecret } from '../common/crypto/secret-crypto';
import { venuePublicUrl, venueLogoAbsoluteUrl } from '../common/venue-url/venue-url';
import { loyverseClient } from '../loyverse/loyverse-client';
import { CustomersService } from '../customers/customers.service';
import { OnlineOrdersMailService } from './online-orders-mail.service';
import { CreateOnlineOrderDto } from './dto/create-online-order.dto';
import { CartDto } from './dto/cart-line.dto';
import { RejectOnlineOrderDto } from './dto/reject-online-order.dto';
import { ProposeOrderTimeChangeDto } from './dto/propose-order-time-change.dto';
import { CompleteOnlineOrderDto } from './dto/complete-online-order.dto';

/** Margine fisso (non configurabile) di preparazione ad apertura/chiusura di ciascuna fascia cucina — v. §5.10 di DEVELOPMENT.md. */
const KITCHEN_MARGIN_MINUTES = 30;

const VENUE_SELECT = {
  id: true,
  name: true,
  slug: true,
  email: true,
  logoUrl: true,
  timezone: true,
  gpsLat: true,
  gpsLng: true,
  onlineOrdersEnabled: true,
  onlineOrdersPickupEnabled: true,
  onlineOrdersDeliveryEnabled: true,
  onlineOrdersOpeningHours: true,
  openingHours: true,
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
  sumupApiKeyEnc: true,
  loyverseIntegrationEnabled: true,
  loyverseAccessTokenEnc: true,
  loyverseStoreId: true,
  loyversePaymentTypeIdCash: true,
  loyversePaymentTypeIdCardOnline: true,
  loyversePaymentTypeIdCardInStore: true,
} as const;

type OnlineOrdersVenueSettings = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  logoUrl: string | null;
  timezone: string;
  gpsLat: number | null;
  gpsLng: number | null;
  onlineOrdersEnabled: boolean;
  onlineOrdersPickupEnabled: boolean;
  onlineOrdersDeliveryEnabled: boolean;
  onlineOrdersOpeningHours: unknown;
  openingHours: unknown;
  onlineOrdersMinLeadMinutes: number;
  onlineOrdersAutoAcceptEnabled: boolean;
  onlineOrdersAutoAcceptSlotMode: 'COMBINED' | 'SEPARATE';
  onlineOrdersAutoAcceptPerSlot: number;
  onlineOrdersAutoAcceptPerSlotPickup: number;
  onlineOrdersAutoAcceptPerSlotDelivery: number;
  deliveryRadiusMeters: number | null;
  deliveryFee: number;
  deliveryFreeAboveAmount: number | null;
  sumupEnabled: boolean;
  sumupApiKeyEnc: string | null;
  loyverseIntegrationEnabled: boolean;
  loyverseAccessTokenEnc: string | null;
  loyverseStoreId: string | null;
  loyversePaymentTypeIdCash: string | null;
  loyversePaymentTypeIdCardOnline: string | null;
  loyversePaymentTypeIdCardInStore: string | null;
};

const HISTORY_STATUSES: OnlineOrderStatus[] = ['COMPLETED', 'REJECTED', 'CANCELLED'];
const QUEUE_STATUSES: OnlineOrderStatus[] = ['PENDING', 'CONFIRMED', 'READY'];

interface ResolvedLine {
  menuItemId: string;
  itemName: string;
  variantId: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  note: string | null;
  modifiers: { modifierOptionId: string; optionName: string; price: number }[];
}

interface OrderPricing {
  venue: OnlineOrdersVenueSettings;
  requestedAt: Date;
  awaitingShopOpening: boolean;
  resolvedLines: ResolvedLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryDistanceMeters: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryAddress: string | null;
}

@Injectable()
export class OnlineOrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private customers: CustomersService,
    private mail: OnlineOrdersMailService,
    private pdf: PdfService,
  ) {}

  private async getVenueSettings(venueId: string): Promise<OnlineOrdersVenueSettings> {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: VENUE_SELECT });
    if (!venue) throw new NotFoundException('Locale non trovato');
    return venue as OnlineOrdersVenueSettings;
  }

  /** Pagina pubblica di tracciamento (nessun login), stesso pattern di Reservation.manageToken (§5.7/§5.10). */
  private trackUrl(venue: OnlineOrdersVenueSettings, orderId: string, token: string): string {
    return venuePublicUrl(venue, `/ordina/traccia/${orderId}?token=${token}`);
  }

  /** Link (autenticato) alla coda "Ordini online" in amministrazione, per l'email di notifica al locale. */
  private adminQueueUrl(venue: OnlineOrdersVenueSettings): string {
    return venuePublicUrl(venue, '/online-orders');
  }

  private privacyUrl(venue: OnlineOrdersVenueSettings, privacyToken: string | null): string | null {
    return privacyToken ? venuePublicUrl(venue, `/privacy?token=${privacyToken}`) : null;
  }

  /** Apertura speciale (§5.10) per la data di "at" (nel fuso del locale), se configurata. */
  private async findSpecialDay(venueId: string, at: Date, timezone: string) {
    return this.prisma.venueSpecialDay.findUnique({
      where: { venueId_date: { venueId, date: specialDayKey(dateOnlyInZone(at, timezone)) } },
    });
  }

  /** Il giorno risolto dallo schedule normale per "at", sostituito da un'eventuale apertura speciale per quella data. */
  private async resolveRealHoursDay(venue: OnlineOrdersVenueSettings, at: Date) {
    const schedule = resolveOpeningHours(venue.onlineOrdersOpeningHours ?? venue.openingHours);
    const scheduledDay = schedule.find((d) => d.dayOfWeek === jsWeekdayInZone(at, venue.timezone))!;
    const special = await this.findSpecialDay(venue.id, at, venue.timezone);
    return applyDayOverride(scheduledDay, special?.realHoursOverride as DayOverride | null | undefined);
  }

  /**
   * Come validateRequestedTime delle Prenotazioni (§5.7), ma con la
   * fascia ristretta di KITCHEN_MARGIN_MINUTES su ciascun lato (§5.10):
   * usa Venue.onlineOrdersOpeningHours se impostato, altrimenti ricade
   * sugli orari generali del locale — e un'eventuale apertura speciale
   * per quella data specifica sovrascrive il giorno della settimana.
   */
  private async validateRequestedTime(venue: OnlineOrdersVenueSettings, requestedAtIso: string): Promise<Date> {
    const requestedAt = new Date(requestedAtIso);
    if (Number.isNaN(requestedAt.getTime())) {
      throw new BadRequestException('Data/ora non valida');
    }
    const now = new Date();
    if (requestedAt.getTime() < now.getTime()) {
      throw new BadRequestException('Non è possibile ordinare per un orario nel passato');
    }
    if (venue.onlineOrdersMinLeadMinutes > 0) {
      const leadMs = venue.onlineOrdersMinLeadMinutes * 60 * 1000;
      if (requestedAt.getTime() < now.getTime() + leadMs) {
        throw new BadRequestException(
          `È possibile ordinare solo con almeno ${venue.onlineOrdersMinLeadMinutes} minuti di anticipo`,
        );
      }
    }
    const minutesOfDay = minutesOfDayInZone(requestedAt, venue.timezone);
    if (minutesOfDay % 15 !== 0) {
      throw new BadRequestException("L'orario deve essere ai 15 minuti (es. 20:00, 20:15, 20:30, 20:45)");
    }
    const day = await this.resolveRealHoursDay(venue, requestedAt);
    if (findOpenSlotWithMargin(day, minutesOfDay, KITCHEN_MARGIN_MINUTES) === null) {
      throw new BadRequestException(
        day.closed
          ? 'Il locale è chiuso in questo giorno della settimana'
          : 'Orario non disponibile per gli ordini online (troppo presto, troppo tardi, o fuori orario di apertura)',
      );
    }
    return requestedAt;
  }

  /**
   * Cerca il prossimo istante richiedibile (inizio fascia + margine
   * cucina) a partire da "from", scandendo fino a 14 giorni in avanti e
   * tenendo conto di eventuali aperture speciali (§5.10 di
   * DEVELOPMENT.md) — usato solo quando un ordine "il prima possibile"
   * arriva mentre il negozio è chiuso in questo momento (v.
   * resolveAsapRequestedAt sotto).
   */
  private async nextOpeningMoment(venue: OnlineOrdersVenueSettings, from: Date): Promise<Date> {
    for (let offset = 0; offset <= 14; offset++) {
      const candidateBase = addDaysInZone(from, offset, venue.timezone);
      const day = await this.resolveRealHoursDay(venue, candidateBase);
      if (day.closed) continue;
      for (const [start, end] of [
        [day.slot1Start, day.slot1End],
        [day.slot2Start, day.slot2End],
      ] as const) {
        if (!start || !end) continue;
        const marginStart = hhmmToMinutes(start) + KITCHEN_MARGIN_MINUTES;
        const marginEnd = hhmmToMinutes(end) - KITCHEN_MARGIN_MINUTES;
        if (marginStart > marginEnd) continue; // fascia troppo corta per il margine di cucina
        const candidateStart = dateAtTimeInZone(from, offset, minutesToHhmm(marginStart), venue.timezone);
        if (candidateStart.getTime() >= from.getTime()) return candidateStart;
      }
    }
    throw new BadRequestException('Nessun orario di apertura trovato nei prossimi 14 giorni: contatta il locale.');
  }

  /**
   * Un ordine "il prima possibile" (checkout senza data/ora scelta a
   * mano): se il negozio è aperto adesso (con lo stesso margine cucina
   * degli ordini programmati), l'ordine parte per subito, arrotondato al
   * quarto d'ora successivo — stessa granularità degli ordini
   * programmati, per la stessa logica di occupazione/accettazione
   * automatica per fascia. Se invece il negozio è chiuso in questo
   * momento, l'ordine nasce comunque (non viene bloccato, §5.10 su
   * richiesta esplicita dell'utente): "requestedAt" diventa il prossimo
   * istante di apertura utile e "awaitingShopOpening" true, così lo staff
   * lo saprà solo da lì in poi (v. accept/createPublicOrder).
   */
  private async resolveAsapRequestedAt(
    venue: OnlineOrdersVenueSettings,
  ): Promise<{ requestedAt: Date; awaitingShopOpening: boolean }> {
    const now = new Date();
    const day = await this.resolveRealHoursDay(venue, now);
    const minutesOfDay = minutesOfDayInZone(now, venue.timezone);
    if (findOpenSlotWithMargin(day, minutesOfDay, KITCHEN_MARGIN_MINUTES) !== null) {
      const quarterMs = 15 * 60 * 1000;
      return { requestedAt: new Date(Math.ceil(now.getTime() / quarterMs) * quarterMs), awaitingShopOpening: false };
    }
    return { requestedAt: await this.nextOpeningMoment(venue, now), awaitingShopOpening: true };
  }

  /**
   * Ordini non chiusi (v. QUEUE_STATUSES) già presenti nella stessa fascia
   * da 15 minuti di "requestedAt", per l'accettazione automatica (§5.10).
   * "SEPARATE" conta solo gli ordini della stessa modalità; "COMBINED"
   * conta ritiro+consegna insieme.
   */
  private async countSlotOccupancy(
    venueId: string,
    requestedAt: Date,
    slotMode: 'COMBINED' | 'SEPARATE',
    fulfillment: OnlineOrderFulfillment,
  ): Promise<number> {
    const slotStart = new Date(requestedAt);
    slotStart.setSeconds(0, 0);
    slotStart.setMinutes(Math.floor(slotStart.getMinutes() / 15) * 15);
    const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);

    return this.prisma.onlineOrder.count({
      where: {
        venueId,
        requestedAt: { gte: slotStart, lt: slotEnd },
        status: { in: QUEUE_STATUSES.concat('COMPLETED') },
        ...(slotMode === 'SEPARATE' ? { fulfillment } : {}),
      },
    });
  }

  /**
   * Ricalcola prezzi/validità del carrello lato server (mai fidarsi dei
   * prezzi inviati dal client), valida orario/canale/raggio di consegna.
   * Condivisa fra il checkout intent SumUp e la creazione ordine finale.
   */
  private async computeOrderPricing(
    venueId: string,
    cart: CartDto,
    fulfillment: OnlineOrderFulfillment,
    requestedAtIso: string | undefined,
    asap: boolean,
    delivery?: { address?: string; lat?: number; lng?: number },
  ): Promise<OrderPricing> {
    const venue = await this.getVenueSettings(venueId);
    if (!venue.onlineOrdersEnabled) {
      throw new ForbiddenException('Gli ordini online non sono attivi per questo locale');
    }
    if (fulfillment === 'PICKUP' && !venue.onlineOrdersPickupEnabled) {
      throw new ForbiddenException('Il ritiro in negozio non è disponibile per questo locale');
    }
    if (fulfillment === 'DELIVERY' && !venue.onlineOrdersDeliveryEnabled) {
      throw new ForbiddenException('La consegna a domicilio non è disponibile per questo locale');
    }

    let requestedAt: Date;
    let awaitingShopOpening: boolean;
    if (asap) {
      ({ requestedAt, awaitingShopOpening } = await this.resolveAsapRequestedAt(venue));
    } else {
      if (!requestedAtIso) throw new BadRequestException("L'orario richiesto è obbligatorio");
      requestedAt = await this.validateRequestedTime(venue, requestedAtIso);
      awaitingShopOpening = false;
    }

    const variantIds = [...new Set(cart.lines.map((l) => l.variantId))];
    const variants = await this.prisma.menuItemVariant.findMany({
      where: { id: { in: variantIds } },
      include: { menuItem: { include: { category: true } } },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));

    const modifierOptionIds = [...new Set(cart.lines.flatMap((l) => l.modifierOptionIds ?? []))];
    const modifierOptions = modifierOptionIds.length
      ? await this.prisma.menuModifierOption.findMany({
          where: { id: { in: modifierOptionIds } },
          include: { group: { include: { items: true } } },
        })
      : [];
    const modifierOptionById = new Map(modifierOptions.map((o) => [o.id, o]));

    let subtotal = 0;
    const resolvedLines: ResolvedLine[] = [];
    for (const line of cart.lines) {
      const variant = variantById.get(line.variantId);
      if (
        !variant ||
        variant.menuItemId !== line.menuItemId ||
        variant.menuItem.venueId !== venueId ||
        !variant.active
      ) {
        throw new BadRequestException('Una voce del carrello non è più disponibile');
      }
      if (
        !variant.menuItem.orderableOnline ||
        !variant.menuItem.visible ||
        !variant.menuItem.category.orderableOnline ||
        !variant.menuItem.category.visible
      ) {
        throw new BadRequestException(`"${variant.menuItem.name}" non è ordinabile online`);
      }
      if (variant.menuItem.unavailableUntil && variant.menuItem.unavailableUntil > new Date()) {
        throw new BadRequestException(`"${variant.menuItem.name}" è temporaneamente esaurito`);
      }
      if (variant.price == null) {
        throw new BadRequestException(`"${variant.menuItem.name}" ha un prezzo variabile, non ordinabile online`);
      }

      const modifiers: ResolvedLine['modifiers'] = [];
      for (const optionId of line.modifierOptionIds ?? []) {
        const option = modifierOptionById.get(optionId);
        if (
          !option ||
          option.group.venueId !== venueId ||
          !option.group.items.some((i) => i.menuItemId === line.menuItemId)
        ) {
          throw new BadRequestException('Un modificatore scelto non è valido per questa voce');
        }
        modifiers.push({ modifierOptionId: option.id, optionName: option.name, price: option.price });
      }

      const lineTotal =
        line.quantity * (variant.price + modifiers.reduce((sum, m) => sum + m.price, 0));
      subtotal += lineTotal;

      resolvedLines.push({
        menuItemId: line.menuItemId,
        itemName: variant.menuItem.name,
        variantId: variant.id,
        variantName: variant.name,
        quantity: line.quantity,
        unitPrice: variant.price,
        note: line.note ?? null,
        modifiers,
      });
    }

    let deliveryFee = 0;
    let deliveryDistanceMeters: number | null = null;
    let deliveryLat: number | null = null;
    let deliveryLng: number | null = null;
    let deliveryAddress: string | null = null;

    if (fulfillment === 'DELIVERY') {
      if (venue.gpsLat == null || venue.gpsLng == null) {
        throw new BadRequestException("Posizione del locale non ancora configurata dall'amministratore");
      }
      deliveryAddress = delivery?.address?.trim() || null;
      deliveryLat = delivery?.lat ?? null;
      deliveryLng = delivery?.lng ?? null;
      if ((deliveryLat == null || deliveryLng == null) && deliveryAddress) {
        const geocoded = await locationIqClient.forwardGeocode(deliveryAddress);
        if (!geocoded) throw new BadRequestException('Indirizzo di consegna non trovato, correggilo sulla mappa');
        deliveryLat = geocoded.lat;
        deliveryLng = geocoded.lng;
      }
      if (deliveryLat == null || deliveryLng == null || !deliveryAddress) {
        throw new BadRequestException('Indirizzo di consegna mancante');
      }
      deliveryDistanceMeters = distanceMeters(venue.gpsLat, venue.gpsLng, deliveryLat, deliveryLng);
      if (venue.deliveryRadiusMeters != null && deliveryDistanceMeters > venue.deliveryRadiusMeters) {
        throw new ConflictException(
          `Il punto di consegna è troppo lontano dal locale (${Math.round(deliveryDistanceMeters)} m, massimo ${venue.deliveryRadiusMeters} m)`,
        );
      }
      deliveryFee =
        venue.deliveryFreeAboveAmount != null && subtotal >= venue.deliveryFreeAboveAmount
          ? 0
          : venue.deliveryFee;
    }

    return {
      venue,
      requestedAt,
      awaitingShopOpening,
      resolvedLines,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      deliveryDistanceMeters,
      deliveryLat,
      deliveryLng,
      deliveryAddress,
    };
  }

  /** Crea un checkout SumUp per l'importo calcolato dal carrello, prima della conferma finale dell'ordine (solo consegna, CARD_ONLINE). */
  async initiateSumUpCheckout(
    venueId: string,
    cart: CartDto,
    requestedAt: string | undefined,
    asap: boolean,
    delivery: { address?: string; lat?: number; lng?: number },
  ) {
    const pricing = await this.computeOrderPricing(venueId, cart, 'DELIVERY', requestedAt, asap, delivery);
    if (!pricing.venue.sumupEnabled || !pricing.venue.sumupApiKeyEnc) {
      throw new BadRequestException('Il pagamento con carta online non è disponibile per questo locale');
    }
    const checkout = await sumupClient.createCheckout(decryptSecret(pricing.venue.sumupApiKeyEnc), {
      checkoutReference: randomUUID(),
      amount: pricing.total,
      currency: 'EUR',
      description: `Ordine online — ${pricing.venue.name}`,
    });
    return { checkoutId: checkout.id, total: pricing.total };
  }

  async createPublicOrder(venueId: string, dto: CreateOnlineOrderDto): Promise<OnlineOrder> {
    if (dto.privacyPolicyConsent !== true) {
      throw new BadRequestException('Devi autorizzare il trattamento dei dati personali per completare l\'ordine.');
    }

    const pricing = await this.computeOrderPricing(
      venueId,
      { lines: dto.lines },
      dto.fulfillment,
      dto.requestedAt,
      dto.asap ?? false,
      { address: dto.deliveryAddress, lat: dto.deliveryLat, lng: dto.deliveryLng },
    );

    let paymentMethod: OnlineOrderPaymentMethod | null = null;
    let paymentStatus: 'PENDING' | 'PAID' = 'PENDING';
    let sumupCheckoutId: string | null = null;
    let sumupTransactionId: string | null = null;

    if (dto.fulfillment === 'DELIVERY') {
      if (dto.paymentMethod !== 'CASH' && dto.paymentMethod !== 'CARD_ONLINE') {
        throw new BadRequestException('Metodo di pagamento non valido per la consegna');
      }
      paymentMethod = dto.paymentMethod;
      if (dto.paymentMethod === 'CARD_ONLINE') {
        if (!pricing.venue.sumupEnabled || !pricing.venue.sumupApiKeyEnc || !dto.sumupCheckoutId) {
          throw new BadRequestException('Pagamento con carta online non disponibile o non completato');
        }
        const checkout = await sumupClient.getCheckout(
          decryptSecret(pricing.venue.sumupApiKeyEnc),
          dto.sumupCheckoutId,
        );
        if (checkout.status !== 'PAID') {
          throw new BadRequestException('Il pagamento non risulta ancora completato');
        }
        paymentStatus = 'PAID';
        sumupCheckoutId = checkout.id;
        sumupTransactionId = checkout.transactions?.[0]?.id ?? null;
      }
    }
    // Per il ritiro paymentMethod resta null: lo decide l'operatore al ritiro fisico (§5.10).

    const occupancy = await this.countSlotOccupancy(
      venueId,
      pricing.requestedAt,
      pricing.venue.onlineOrdersAutoAcceptSlotMode,
      dto.fulfillment,
    );
    const threshold =
      pricing.venue.onlineOrdersAutoAcceptSlotMode === 'SEPARATE'
        ? dto.fulfillment === 'PICKUP'
          ? pricing.venue.onlineOrdersAutoAcceptPerSlotPickup
          : pricing.venue.onlineOrdersAutoAcceptPerSlotDelivery
        : pricing.venue.onlineOrdersAutoAcceptPerSlot;
    // Un ordine in attesa di apertura (§5.10) non viene mai accettato in
    // automatico: non avrebbe senso confermarlo mentre il negozio è ancora
    // chiuso e non può prepararlo.
    const initialStatus: OnlineOrderStatus =
      !pricing.awaitingShopOpening && pricing.venue.onlineOrdersAutoAcceptEnabled && occupancy < threshold
        ? 'CONFIRMED'
        : 'PENDING';

    const customer = await this.customers.recordOnlineOrder(venueId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      marketingConsent: dto.marketingConsent ?? false,
    });

    const order = await this.prisma.onlineOrder.create({
      data: {
        venueId,
        customerId: customer.id,
        fulfillment: dto.fulfillment,
        status: initialStatus,
        requestedAt: pricing.requestedAt,
        awaitingShopOpening: pricing.awaitingShopOpening,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone,
        deliveryAddress: pricing.deliveryAddress,
        deliveryLat: pricing.deliveryLat,
        deliveryLng: pricing.deliveryLng,
        deliveryDistanceMeters: pricing.deliveryDistanceMeters,
        deliveryFee: pricing.deliveryFee,
        subtotal: pricing.subtotal,
        total: pricing.total,
        paymentMethod,
        paymentStatus,
        sumupCheckoutId,
        sumupTransactionId,
        marketingConsent: dto.marketingConsent ?? false,
        privacyPolicyConsent: true,
        manageToken: randomUUID(),
        lines: {
          create: pricing.resolvedLines.map((line) => ({
            menuItemId: line.menuItemId,
            itemName: line.itemName,
            variantId: line.variantId,
            variantName: line.variantName,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            note: line.note,
            modifiers: {
              create: line.modifiers.map((m) => ({
                modifierOptionId: m.modifierOptionId,
                optionName: m.optionName,
                price: m.price,
              })),
            },
          })),
        },
      },
      include: { lines: { include: { modifiers: true } } },
    });

    const venue = pricing.venue;
    const logoUrl = venueLogoAbsoluteUrl(venue);
    const trackUrl = this.trackUrl(venue, order.id, order.manageToken);
    const privacyUrl = this.privacyUrl(venue, customer.privacyToken);
    if (initialStatus === 'CONFIRMED') {
      await this.mail.sendConfirmed(order, venue.name, trackUrl, venue.email, privacyUrl, logoUrl);
    } else if (order.awaitingShopOpening) {
      await this.mail.sendReceivedAwaitingOpening(order, venue.name, trackUrl, venue.email, privacyUrl, logoUrl);
    } else {
      await this.mail.sendReceived(order, venue.name, trackUrl, venue.email, privacyUrl, logoUrl);
    }
    // Notifica sonora nella coda admin: v. OnlineOrdersAdmin.tsx (confronto poll su poll, §5.10).
    if (venue.email) {
      await this.mail.sendVenueNotification(
        order,
        venue.name,
        venue.email,
        this.adminQueueUrl(venue),
        initialStatus === 'PENDING',
        logoUrl,
      );
    }
    return order;
  }

  private async requireOrder(venueId: string, id: string) {
    const order = await this.prisma.onlineOrder.findFirst({
      where: { id, venueId },
      include: { lines: { include: { modifiers: true } } },
    });
    if (!order) throw new NotFoundException('Ordine non trovato');
    return order;
  }

  listQueue(venueId: string) {
    return this.prisma.onlineOrder.findMany({
      where: { venueId, status: { in: QUEUE_STATUSES } },
      include: { lines: { include: { modifiers: true } } },
      orderBy: { requestedAt: 'asc' },
    });
  }

  listHistory(
    venueId: string,
    filters: { status?: OnlineOrderStatus[]; from?: Date; to?: Date },
  ) {
    return this.prisma.onlineOrder.findMany({
      where: {
        venueId,
        status: { in: filters.status?.length ? filters.status : HISTORY_STATUSES },
        ...(filters.from || filters.to
          ? { requestedAt: { gte: filters.from, lte: filters.to } }
          : {}),
      },
      include: { lines: { include: { modifiers: true } } },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async accept(user: AuthenticatedUser, venueId: string, id: string) {
    const order = await this.requireOrder(venueId, id);
    if (order.status !== 'PENDING') {
      throw new BadRequestException('Solo un ordine in attesa può essere accettato');
    }
    const updated = await this.prisma.onlineOrder.update({
      where: { id },
      data: { status: 'CONFIRMED' },
      include: { lines: { include: { modifiers: true } } },
    });
    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'OnlineOrder',
      entityId: id,
      action: 'UPDATE',
      before: order,
      after: updated,
    });
    const venue = await this.getVenueSettings(venueId);
    const privacyToken = await this.customers.ensurePrivacyToken(venueId, updated.email);
    await this.mail.sendConfirmed(
      updated,
      venue.name,
      this.trackUrl(venue, updated.id, updated.manageToken),
      venue.email,
      this.privacyUrl(venue, privacyToken),
      venueLogoAbsoluteUrl(venue),
    );
    return updated;
  }

  async reject(user: AuthenticatedUser, venueId: string, id: string, dto: RejectOnlineOrderDto) {
    const order = await this.requireOrder(venueId, id);
    if (order.status === 'COMPLETED' || order.status === 'REJECTED' || order.status === 'CANCELLED') {
      throw new BadRequestException('Ordine già concluso, non può essere rifiutato');
    }
    const updated = await this.prisma.onlineOrder.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: dto.reason },
      include: { lines: { include: { modifiers: true } } },
    });
    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'OnlineOrder',
      entityId: id,
      action: 'UPDATE',
      before: order,
      after: updated,
    });

    // Il rifiuto di un ordine pagato non deve mai lasciare il cliente
    // addebitato senza che l'ordine venga preparato (§5.10 di
    // DEVELOPMENT.md): l'ordine resta comunque REJECTED anche se il
    // rimborso fallisce, ma l'errore va sempre segnalato allo staff.
    const venue = await this.getVenueSettings(venueId);
    if (order.paymentMethod === 'CARD_ONLINE' && order.paymentStatus === 'PAID' && order.sumupTransactionId) {
      if (venue.sumupApiKeyEnc) {
        try {
          await sumupClient.refund(decryptSecret(venue.sumupApiKeyEnc), order.sumupTransactionId);
          await this.prisma.onlineOrder.update({ where: { id }, data: { paymentStatus: 'REFUNDED' } });
        } catch (err) {
          throw new BadRequestException(
            `Ordine rifiutato, ma il rimborso automatico su SumUp non è riuscito: rimborsa manualmente dal Dashboard SumUp. Dettaglio: ${(err as Error).message}`,
          );
        }
      }
    }

    const privacyToken = await this.customers.ensurePrivacyToken(venueId, updated.email);
    await this.mail.sendRejected(
      updated,
      venue.name,
      dto.reason,
      venue.email,
      this.privacyUrl(venue, privacyToken),
      venueLogoAbsoluteUrl(venue),
    );

    return updated;
  }

  async markReady(user: AuthenticatedUser, venueId: string, id: string) {
    const order = await this.requireOrder(venueId, id);
    if (order.status !== 'CONFIRMED') {
      throw new BadRequestException('Solo un ordine confermato può essere segnato come pronto');
    }
    const updated = await this.prisma.onlineOrder.update({
      where: { id },
      data: { status: 'READY' },
      include: { lines: { include: { modifiers: true } } },
    });
    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'OnlineOrder',
      entityId: id,
      action: 'UPDATE',
      before: order,
      after: updated,
    });
    const venue = await this.getVenueSettings(venueId);
    const privacyToken = await this.customers.ensurePrivacyToken(venueId, updated.email);
    await this.mail.sendReady(
      updated,
      venue.name,
      this.trackUrl(venue, updated.id, updated.manageToken),
      venue.email,
      this.privacyUrl(venue, privacyToken),
      venueLogoAbsoluteUrl(venue),
    );
    return updated;
  }

  async complete(user: AuthenticatedUser, venueId: string, id: string, dto: CompleteOnlineOrderDto) {
    const order = await this.requireOrder(venueId, id);
    if (order.status !== 'READY') {
      throw new BadRequestException('Solo un ordine pronto può essere completato');
    }

    const data: { status: OnlineOrderStatus; paymentMethod?: OnlineOrderPaymentMethod; paymentStatus?: 'PAID' } = {
      status: 'COMPLETED',
    };
    if (order.fulfillment === 'PICKUP') {
      // Per il ritiro il pagamento è deciso dall'operatore solo ora, non dal cliente online (§5.10).
      if (dto.paymentMethod !== 'CASH' && dto.paymentMethod !== 'CARD_IN_STORE') {
        throw new BadRequestException('Indica come il cliente ha pagato (contanti o carta in negozio)');
      }
      data.paymentMethod = dto.paymentMethod;
      data.paymentStatus = 'PAID';
    }

    const updated = await this.prisma.onlineOrder.update({
      where: { id },
      data,
      include: { lines: { include: { modifiers: true } } },
    });
    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'OnlineOrder',
      entityId: id,
      action: 'UPDATE',
      before: order,
      after: updated,
    });

    if (updated.customerId) {
      await this.customers.recordOnlineOrderCompleted(updated.customerId, updated.total);
    }

    // Nessun interruttore proprio (§5.10, su richiesta esplicita
    // dell'utente): la sincronizzazione segue sempre l'integrazione
    // Loyverse generale del locale, mai un secondo opt-in ridondante.
    const venue = await this.getVenueSettings(venueId);
    if (venue.loyverseIntegrationEnabled && venue.loyverseAccessTokenEnc) {
      return this.syncLoyverseReceipt(venue, updated);
    }

    return updated;
  }

  /**
   * Crea la ricevuta Loyverse per un ordine appena COMPLETED (§5.10 di
   * DEVELOPMENT.md — solo qui, mai per un ordine ancora aperto). Un
   * fallimento qualunque (mappatura pagamento assente, voce senza
   * corrispondente Loyverse, errore di rete/API) non deve mai bloccare
   * l'ordine reale: viene solo salvato come `loyverseSyncError`, sullo
   * stesso schema di `Order.emailSent`/`emailError` per gli ordini
   * fornitori.
   */
  private async syncLoyverseReceipt(
    venue: OnlineOrdersVenueSettings,
    order: OnlineOrder & { lines: (OnlineOrderLine & { modifiers: OnlineOrderLineModifier[] })[] },
  ) {
    try {
      const paymentTypeId =
        order.paymentMethod === 'CASH'
          ? venue.loyversePaymentTypeIdCash
          : order.paymentMethod === 'CARD_ONLINE'
            ? venue.loyversePaymentTypeIdCardOnline
            : order.paymentMethod === 'CARD_IN_STORE'
              ? venue.loyversePaymentTypeIdCardInStore
              : null;
      if (!paymentTypeId) {
        throw new Error('Metodo di pagamento non collegato a Loyverse (v. Impostazioni Loyverse)');
      }

      const accessToken = decryptSecret(venue.loyverseAccessTokenEnc!);

      let storeId = venue.loyverseStoreId;
      if (!storeId) {
        const stores = await loyverseClient.listStores(accessToken);
        storeId = stores[0]?.id ?? null;
        if (!storeId) throw new Error('Nessun punto vendita trovato sull\'account Loyverse collegato');
        await this.prisma.venue.update({ where: { id: venue.id }, data: { loyverseStoreId: storeId } });
      }

      const variantIds = [...new Set(order.lines.map((l) => l.variantId))];
      const variants = await this.prisma.menuItemVariant.findMany({ where: { id: { in: variantIds } } });
      const loyverseVariantIdByLocalId = new Map(variants.map((v) => [v.id, v.loyverseVariantId]));

      const modifierOptionIds = [...new Set(order.lines.flatMap((l) => l.modifiers.map((m) => m.modifierOptionId)))];
      const modifierOptions = modifierOptionIds.length
        ? await this.prisma.menuModifierOption.findMany({ where: { id: { in: modifierOptionIds } } })
        : [];
      const loyverseModifierOptionIdByLocalId = new Map(
        modifierOptions.map((o) => [o.id, o.loyverseModifierOptionId]),
      );

      const lineItems = order.lines.map((line) => {
        const loyverseVariantId = loyverseVariantIdByLocalId.get(line.variantId);
        if (!loyverseVariantId) {
          throw new Error(`"${line.itemName}" non ha un corrispondente Loyverse sincronizzato`);
        }
        return {
          variant_id: loyverseVariantId,
          quantity: line.quantity,
          price: line.unitPrice,
          line_modifiers: line.modifiers.map((m) => {
            const loyverseModifierOptionId = loyverseModifierOptionIdByLocalId.get(m.modifierOptionId);
            if (!loyverseModifierOptionId) {
              throw new Error(`"${m.optionName}" non ha un corrispondente Loyverse sincronizzato`);
            }
            return { modifier_option_id: loyverseModifierOptionId, price: m.price };
          }),
        };
      });

      const receipt = await loyverseClient.createReceipt(accessToken, {
        store_id: storeId,
        line_items: lineItems,
        payments: [{ payment_type_id: paymentTypeId, money_amount: order.total }],
        receipt_date: new Date().toISOString(),
      });

      return this.prisma.onlineOrder.update({
        where: { id: order.id },
        data: { loyverseReceiptId: receipt.receipt_number, loyverseSyncError: null },
        include: { lines: { include: { modifiers: true } } },
      });
    } catch (err) {
      return this.prisma.onlineOrder.update({
        where: { id: order.id },
        data: { loyverseSyncError: (err as Error).message },
        include: { lines: { include: { modifiers: true } } },
      });
    }
  }

  async cancel(user: AuthenticatedUser, venueId: string, id: string) {
    const order = await this.requireOrder(venueId, id);
    if (order.status === 'COMPLETED' || order.status === 'REJECTED' || order.status === 'CANCELLED') {
      throw new BadRequestException('Ordine già concluso');
    }
    const updated = await this.prisma.onlineOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: { lines: { include: { modifiers: true } } },
    });
    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'OnlineOrder',
      entityId: id,
      action: 'UPDATE',
      before: order,
      after: updated,
    });
    return updated;
  }

  /** Propone un nuovo orario (tipicamente per spostare l'ordine da una fascia satura, §5.10): nessun vincolo di orario/fascia, è un'azione dello staff. */
  async proposeTimeChange(user: AuthenticatedUser, venueId: string, id: string, dto: ProposeOrderTimeChangeDto) {
    const order = await this.requireOrder(venueId, id);
    if (order.status === 'COMPLETED' || order.status === 'REJECTED' || order.status === 'CANCELLED') {
      throw new BadRequestException('Ordine chiuso: non è possibile modificare l\'orario');
    }
    const proposedRequestedAt = new Date(dto.requestedAt);
    if (Number.isNaN(proposedRequestedAt.getTime())) {
      throw new BadRequestException('Data/ora non valida');
    }
    const updated = await this.prisma.onlineOrder.update({
      where: { id },
      data: { proposedRequestedAt },
      include: { lines: { include: { modifiers: true } } },
    });
    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'OnlineOrder',
      entityId: id,
      action: 'UPDATE',
      before: order,
      after: updated,
    });
    const venue = await this.getVenueSettings(venueId);
    const privacyToken = await this.customers.ensurePrivacyToken(venueId, updated.email);
    await this.mail.sendTimeChangeRequest(
      updated,
      venue.name,
      this.trackUrl(venue, updated.id, updated.manageToken),
      venue.email,
      this.privacyUrl(venue, privacyToken),
      venueLogoAbsoluteUrl(venue),
    );
    return updated;
  }

  /** Pagina pubblica di tracciamento (nessun login), identificata dal manageToken. */
  async getForManage(id: string, token: string) {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id },
      include: { lines: { include: { modifiers: true } } },
    });
    if (!order || order.manageToken !== token) throw new NotFoundException('Ordine non trovato');
    return order;
  }

  /** Il cliente conferma il nuovo orario proposto dallo staff, dal link nella pagina di tracciamento. */
  async confirmTimeChangeByToken(id: string, token: string) {
    const order = await this.prisma.onlineOrder.findUnique({ where: { id } });
    if (!order || order.manageToken !== token) throw new NotFoundException('Ordine non trovato');
    if (!order.proposedRequestedAt) {
      throw new BadRequestException('Nessun nuovo orario da confermare');
    }
    return this.prisma.onlineOrder.update({
      where: { id },
      data: { requestedAt: order.proposedRequestedAt, proposedRequestedAt: null },
      include: { lines: { include: { modifiers: true } } },
    });
  }

  private fulfillmentLabel(order: { fulfillment: OnlineOrderFulfillment }): string {
    return order.fulfillment === 'DELIVERY' ? 'Consegna a domicilio' : 'Ritiro in negozio';
  }

  private paymentMethodLabel(method: OnlineOrderPaymentMethod | null): string {
    if (method === 'CASH') return 'Contanti';
    if (method === 'CARD_ONLINE') return 'Carta (pagata online)';
    if (method === 'CARD_IN_STORE') return 'Carta in negozio';
    return 'Non ancora indicato';
  }

  /**
   * Comanda cucina (§5.10 di DEVELOPMENT.md): solo voci/varianti/
   * modificatori/note per riga — nessun prezzo, nessun totale, nessun
   * indirizzo, pensata per restare in cucina/bar dove non deve essere
   * visibile l'importo pagato dal cliente.
   */
  private buildKitchenTicketPayload(
    venueName: string,
    order: OnlineOrder & { lines: (OnlineOrderLine & { modifiers: OnlineOrderLineModifier[] })[] },
  ): ReceiptSection {
    const lines = order.lines.flatMap((line) => [
      `${line.quantity}x ${line.itemName}${line.variantName ? ` (${line.variantName})` : ''}`,
      ...line.modifiers.map((m) => `  + ${m.optionName}`),
      ...(line.note ? [`  nota: ${line.note}`] : []),
    ]);
    return {
      title: `Comanda ${this.fulfillmentLabel(order).toLowerCase()} — ${order.firstName} ${order.lastName}`,
      lines,
      letterhead: [venueName],
    };
  }

  /**
   * Scontrino completo (§5.10): dati cliente, modalità e indirizzo di
   * consegna se presente, ogni riga con prezzo, costo di consegna,
   * totale, metodo e stato del pagamento — pensato per lo staff/il rider,
   * o da allegare alla consegna.
   */
  private buildFullReceiptPayload(
    venue: { name: string; menuAddress?: string | null; city?: string | null; vatNumber?: string | null },
    order: OnlineOrder & { lines: (OnlineOrderLine & { modifiers: OnlineOrderLineModifier[] })[] },
  ): ReceiptSection {
    const letterheadExtra = [venue.city, venue.vatNumber ? `P.IVA ${venue.vatNumber}` : null]
      .filter(Boolean)
      .join(' — ');
    const letterhead = [venue.name, venue.menuAddress, letterheadExtra || null].filter(
      (l): l is string => !!l,
    );

    const header = [
      `${order.firstName} ${order.lastName} — ${order.phone}`,
      this.fulfillmentLabel(order),
      ...(order.fulfillment === 'DELIVERY' && order.deliveryAddress ? [order.deliveryAddress] : []),
      '',
    ];

    const productLines = order.lines.flatMap((line) => {
      const lineTotal = line.quantity * (line.unitPrice + line.modifiers.reduce((sum, m) => sum + m.price, 0));
      const base = `${line.quantity}x ${line.itemName}${line.variantName ? ` (${line.variantName})` : ''}`;
      return [
        `${base}  €${lineTotal.toFixed(2)}`,
        ...line.modifiers.map((m) => `  + ${m.optionName}  €${m.price.toFixed(2)}`),
        ...(line.note ? [`  nota: ${line.note}`] : []),
      ];
    });

    const footer = [
      `Subtotale: €${order.subtotal.toFixed(2)}`,
      ...(order.deliveryFee > 0 ? [`Consegna: €${order.deliveryFee.toFixed(2)}`] : []),
      `TOTALE: €${order.total.toFixed(2)}`,
      `Pagamento: ${this.paymentMethodLabel(order.paymentMethod)} (${order.paymentStatus})`,
    ];

    return {
      title: `Ordine ${order.firstName} ${order.lastName}`,
      lines: [...header, ...productLines],
      footer,
      letterhead,
    };
  }

  /** PDF comanda cucina di un ordine, largo come uno scontrino: v. buildKitchenTicketPayload. */
  async exportKitchenTicketPdf(venueId: string, id: string): Promise<Buffer> {
    const order = await this.requireOrder(venueId, id);
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: { name: true } });
    if (!venue) throw new NotFoundException('Locale non trovato');
    return this.pdf.buildReceiptDocument([this.buildKitchenTicketPayload(venue.name, order)]);
  }

  /** PDF scontrino completo di un ordine, largo come uno scontrino: v. buildFullReceiptPayload. */
  async exportFullReceiptPdf(venueId: string, id: string): Promise<Buffer> {
    const order = await this.requireOrder(venueId, id);
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { name: true, menuAddress: true, city: true, vatNumber: true },
    });
    if (!venue) throw new NotFoundException('Locale non trovato');
    return this.pdf.buildReceiptDocument([this.buildFullReceiptPayload(venue, order)]);
  }
}
