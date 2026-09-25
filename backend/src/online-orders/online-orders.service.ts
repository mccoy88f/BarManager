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
  OnlineOrderPaymentMethod,
  OnlineOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { findOpenSlotWithMargin, resolveOpeningHours } from '../common/opening-hours/opening-hours';
import { jsWeekdayInZone, minutesOfDayInZone } from '../common/timezone/timezone';
import { distanceMeters } from '../common/geo/geo';
import { locationIqClient } from '../common/geo/locationiq-client';
import { sumupClient } from '../common/payments/sumup-client';
import { decryptSecret } from '../common/crypto/secret-crypto';
import { CustomersService } from '../customers/customers.service';
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
} as const;

type OnlineOrdersVenueSettings = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
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
  ) {}

  private async getVenueSettings(venueId: string): Promise<OnlineOrdersVenueSettings> {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: VENUE_SELECT });
    if (!venue) throw new NotFoundException('Locale non trovato');
    return venue as OnlineOrdersVenueSettings;
  }

  /**
   * Come validateRequestedTime delle Prenotazioni (§5.7), ma con la
   * fascia ristretta di KITCHEN_MARGIN_MINUTES su ciascun lato (§5.10):
   * usa Venue.onlineOrdersOpeningHours se impostato, altrimenti ricade
   * sugli orari generali del locale.
   */
  private validateRequestedTime(venue: OnlineOrdersVenueSettings, requestedAtIso: string): Date {
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
    const schedule = resolveOpeningHours(venue.onlineOrdersOpeningHours ?? venue.openingHours);
    const day = schedule.find((d) => d.dayOfWeek === jsWeekdayInZone(requestedAt, venue.timezone))!;
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
    requestedAtIso: string,
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

    const requestedAt = this.validateRequestedTime(venue, requestedAtIso);

    const variantIds = [...new Set(cart.lines.map((l) => l.variantId))];
    const variants = await this.prisma.menuItemVariant.findMany({
      where: { id: { in: variantIds } },
      include: { menuItem: true },
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
      if (!variant.menuItem.orderableOnline || !variant.menuItem.visible) {
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
    requestedAt: string,
    delivery: { address?: string; lat?: number; lng?: number },
  ) {
    const pricing = await this.computeOrderPricing(venueId, cart, 'DELIVERY', requestedAt, delivery);
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

    const pricing = await this.computeOrderPricing(venueId, { lines: dto.lines }, dto.fulfillment, dto.requestedAt, {
      address: dto.deliveryAddress,
      lat: dto.deliveryLat,
      lng: dto.deliveryLng,
    });

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
    const initialStatus: OnlineOrderStatus =
      pricing.venue.onlineOrdersAutoAcceptEnabled && occupancy < threshold ? 'CONFIRMED' : 'PENDING';

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

    // Email al cliente/locale e notifica sonora: v. OnlineOrdersMailService (task successivo).
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
    if (order.paymentMethod === 'CARD_ONLINE' && order.paymentStatus === 'PAID' && order.sumupTransactionId) {
      const venue = await this.getVenueSettings(venueId);
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
    // Sincronizzazione Loyverse (Venue.loyverseSyncOnlineOrders): v. task successivo.

    return updated;
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
    // Email con link alla pagina di tracciamento: v. OnlineOrdersMailService (task successivo).
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
}
