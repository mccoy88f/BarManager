import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OnlineOrdersService } from './online-orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { CustomersService } from '../customers/customers.service';
import { OnlineOrdersMailService } from './online-orders-mail.service';
import { PdfService } from '../reports/pdf.service';
import { encryptSecret } from '../common/crypto/secret-crypto';
import { sumupClient, SumUpApiError } from '../common/payments/sumup-client';
import { loyverseClient } from '../loyverse/loyverse-client';
import { locationIqClient } from '../common/geo/locationiq-client';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

jest.mock('../common/payments/sumup-client', () => ({
  // Serve requireActual per mantenere la vera classe SumUpApiError: senza,
  // il codice del service (`err instanceof SumUpApiError`) confronterebbe
  // con `undefined` e lancerebbe un TypeError invece del comportamento
  // atteso, mascherando la traduzione dell'errore in BadRequestException.
  ...jest.requireActual('../common/payments/sumup-client'),
  sumupClient: {
    createCheckout: jest.fn(),
    getCheckout: jest.fn(),
    getMerchantCode: jest.fn(),
    verifyApiKey: jest.fn(),
    refund: jest.fn(),
  },
}));

jest.mock('../loyverse/loyverse-client', () => ({
  ...jest.requireActual('../loyverse/loyverse-client'),
  loyverseClient: {
    listCategories: jest.fn(),
    listItems: jest.fn(),
    listPaymentTypes: jest.fn(),
    listModifiers: jest.fn(),
    listStores: jest.fn(),
    createReceipt: jest.fn(),
    extractImageUrl: jest.fn(),
  },
}));

jest.mock('../common/geo/locationiq-client', () => ({
  locationIqClient: {
    forwardGeocode: jest.fn(),
    reverseGeocode: jest.fn(),
  },
}));

// Va impostata subito, prima che le fixture qui sotto (valutate in fase di
// collection dei test, non dentro un beforeEach) chiamino encryptSecret —
// altrimenti cifrano con una chiave diversa da quella con cui i test poi
// decifrano, e decryptSecret fallisce con un errore di autenticazione GCM
// che non ha nulla a che fare con lo scenario che il test vuole verificare.
process.env.SECRET_ENCRYPTION_KEY = 'test-key';

const admin: AuthenticatedUser = {
  userId: 'admin-1',
  email: 'admin@venue1.test',
  role: 'ADMIN',
  venueId: 'venue-1',
};

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const baseVenue = {
  id: 'venue-1',
  name: 'Bar Test',
  slug: 'bar-test',
  email: null as string | null,
  logoUrl: null as string | null,
  timezone: TIMEZONE,
  gpsLat: 45.0 as number | null,
  gpsLng: 9.0 as number | null,
  onlineOrdersEnabled: true,
  onlineOrdersPickupEnabled: true,
  onlineOrdersDeliveryEnabled: true,
  onlineOrdersOpeningHours: null as unknown,
  openingHours: null as unknown, // resolveOpeningHours ricade sul default: 12:00-15:00 / 19:00-23:00
  onlineOrdersMinLeadMinutes: 0,
  onlineOrdersMinOrderAmount: null as number | null,
  onlineOrdersAutoAcceptEnabled: false,
  onlineOrdersAutoAcceptSlotMode: 'COMBINED' as 'COMBINED' | 'SEPARATE',
  onlineOrdersAutoAcceptPerSlot: 0,
  onlineOrdersAutoAcceptPerSlotPickup: 0,
  onlineOrdersAutoAcceptPerSlotDelivery: 0,
  deliveryRadiusMeters: null as number | null,
  deliveryFee: 2,
  deliveryFreeAboveAmount: null as number | null,
  sumupEnabled: false,
  sumupApiKeyEnc: null as string | null,
  loyverseIntegrationEnabled: false,
  loyverseAccessTokenEnc: null as string | null,
  loyverseStoreId: null as string | null,
  loyversePaymentTypeIdCash: null as string | null,
  loyversePaymentTypeIdCardOnline: null as string | null,
  loyversePaymentTypeIdCardInStore: null as string | null,
};

/** Prossimo orario di pranzo (12:30, dentro il margine di 30' su un'apertura 12:00-15:00), evita di dipendere da quando girano i test. */
function nextLunchSlot(daysAhead = 2): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(12, 30, 0, 0);
  return d;
}

const variantFixture = {
  id: 'variant-1',
  name: '',
  price: 10,
  active: true,
  loyverseVariantId: null as string | null,
  menuItemId: 'item-1',
  menuItem: {
    id: 'item-1',
    name: 'Pizza Margherita',
    venueId: 'venue-1',
    orderableOnline: true,
    visible: true,
    unavailableUntil: null as Date | null,
    category: { orderableOnline: true, visible: true },
  },
};

function cartDto(overrides?: Partial<{ variantId: string; menuItemId: string; quantity: number; modifierOptionIds: string[] }>) {
  return {
    lines: [
      {
        menuItemId: overrides?.menuItemId ?? 'item-1',
        variantId: overrides?.variantId ?? 'variant-1',
        quantity: overrides?.quantity ?? 2,
        modifierOptionIds: overrides?.modifierOptionIds,
      },
    ],
  };
}

function baseOrderDto(overrides?: Record<string, unknown>) {
  return {
    lines: cartDto().lines,
    fulfillment: 'PICKUP' as const,
    requestedAt: nextLunchSlot().toISOString(),
    firstName: 'Mario',
    lastName: 'Rossi',
    email: 'mario@test.it',
    phone: '3331234567',
    privacyPolicyConsent: true,
    ...overrides,
  };
}

describe('OnlineOrdersService', () => {
  let prisma: {
    venue: { findUnique: jest.Mock; update: jest.Mock };
    menuItemVariant: { findMany: jest.Mock };
    menuModifierOption: { findMany: jest.Mock };
    venueSpecialDay: { findUnique: jest.Mock };
    onlineOrder: {
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let audit: { log: jest.Mock };
  let customers: {
    recordOnlineOrder: jest.Mock;
    recordOnlineOrderCompleted: jest.Mock;
    ensurePrivacyToken: jest.Mock;
  };
  let mail: {
    sendReceived: jest.Mock;
    sendReceivedAwaitingOpening: jest.Mock;
    sendConfirmed: jest.Mock;
    sendReady: jest.Mock;
    sendRejected: jest.Mock;
    sendTimeChangeRequest: jest.Mock;
    sendVenueNotification: jest.Mock;
  };
  let pdf: { buildReceiptDocument: jest.Mock };
  let service: OnlineOrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      venue: { findUnique: jest.fn().mockResolvedValue(baseVenue), update: jest.fn() },
      menuItemVariant: { findMany: jest.fn().mockResolvedValue([variantFixture]) },
      menuModifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      venueSpecialDay: { findUnique: jest.fn().mockResolvedValue(null) },
      onlineOrder: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    };
    audit = { log: jest.fn() };
    customers = {
      recordOnlineOrder: jest.fn().mockResolvedValue({ id: 'customer-1', privacyToken: 'privacy-token' }),
      recordOnlineOrderCompleted: jest.fn(),
      ensurePrivacyToken: jest.fn().mockResolvedValue('privacy-token'),
    };
    mail = {
      sendReceived: jest.fn(),
      sendReceivedAwaitingOpening: jest.fn(),
      sendConfirmed: jest.fn(),
      sendReady: jest.fn(),
      sendRejected: jest.fn(),
      sendTimeChangeRequest: jest.fn(),
      sendVenueNotification: jest.fn(),
    };
    pdf = { buildReceiptDocument: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    service = new OnlineOrdersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      customers as unknown as CustomersService,
      mail as unknown as OnlineOrdersMailService,
      pdf as unknown as PdfService,
    );

    prisma.onlineOrder.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'order-1',
      manageToken: 'manage-token',
      lines: [],
      ...data,
    }));
  });

  describe('createPublicOrder — orario/fasce', () => {
    it('rifiuta un orario non ai 15 minuti', async () => {
      const requestedAt = nextLunchSlot();
      requestedAt.setMinutes(requestedAt.getMinutes() + 7);
      await expect(service.createPublicOrder('venue-1', baseOrderDto({ requestedAt: requestedAt.toISOString() }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rifiuta un orario troppo vicino all\'apertura (dentro il margine di 30 minuti)', async () => {
      const tooEarly = nextLunchSlot();
      tooEarly.setHours(12, 15, 0, 0); // apertura 12:00, margine 30' -> primo slot valido 12:30
      await expect(service.createPublicOrder('venue-1', baseOrderDto({ requestedAt: tooEarly.toISOString() }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rifiuta un orario troppo vicino alla chiusura (dentro il margine di 30 minuti)', async () => {
      const tooLate = nextLunchSlot();
      tooLate.setHours(14, 45, 0, 0); // chiusura 15:00, margine 30' -> ultimo slot valido 14:30
      await expect(service.createPublicOrder('venue-1', baseOrderDto({ requestedAt: tooLate.toISOString() }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accetta un orario esattamente al limite del margine (apertura+30)', async () => {
      const order = await service.createPublicOrder('venue-1', baseOrderDto());
      expect(order).toBeDefined();
      expect(prisma.onlineOrder.create).toHaveBeenCalled();
    });

    it('rifiuta un orario fuori dalla fascia di apertura (pausa pomeridiana)', async () => {
      const afternoon = nextLunchSlot();
      afternoon.setHours(17, 0, 0, 0);
      await expect(service.createPublicOrder('venue-1', baseOrderDto({ requestedAt: afternoon.toISOString() }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rifiuta un orario nel giorno di chiusura del locale', async () => {
      const closedDay = nextLunchSlot();
      prisma.venue.findUnique.mockResolvedValue({
        ...baseVenue,
        onlineOrdersOpeningHours: [{ dayOfWeek: closedDay.getDay(), closed: true, slot1Start: null, slot1End: null, slot2Start: null, slot2End: null }],
      });
      await expect(service.createPublicOrder('venue-1', baseOrderDto({ requestedAt: closedDay.toISOString() }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rispetta l\'anticipo minimo configurato (onlineOrdersMinLeadMinutes)', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, onlineOrdersMinLeadMinutes: 9999 });
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).rejects.toThrow(BadRequestException);
    });

    it('un\'apertura speciale (§5.10) può chiudere un giorno normalmente aperto', async () => {
      const requestedAt = nextLunchSlot();
      prisma.venueSpecialDay.findUnique.mockResolvedValue({
        realHoursOverride: { closed: true, slot1Start: null, slot1End: null, slot2Start: null, slot2End: null },
        menuHoursOverride: null,
      });
      await expect(
        service.createPublicOrder('venue-1', baseOrderDto({ requestedAt: requestedAt.toISOString() })),
      ).rejects.toThrow(BadRequestException);
    });

    it('un\'apertura speciale (§5.10) può aprire un giorno normalmente chiuso', async () => {
      const closedDay = nextLunchSlot();
      prisma.venue.findUnique.mockResolvedValue({
        ...baseVenue,
        onlineOrdersOpeningHours: [
          { dayOfWeek: closedDay.getDay(), closed: true, slot1Start: null, slot1End: null, slot2Start: null, slot2End: null },
        ],
      });
      prisma.venueSpecialDay.findUnique.mockResolvedValue({
        realHoursOverride: { closed: false, slot1Start: '12:00', slot1End: '15:00', slot2Start: null, slot2End: null },
        menuHoursOverride: null,
      });
      const order = await service.createPublicOrder('venue-1', baseOrderDto({ requestedAt: closedDay.toISOString() }));
      expect(order).toBeDefined();
    });

    it('rifiuta un modulo disattivato per il locale (onlineOrdersEnabled=false)', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, onlineOrdersEnabled: false });
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).rejects.toThrow(ForbiddenException);
    });

    it('rifiuta il ritiro se onlineOrdersPickupEnabled è false', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, onlineOrdersPickupEnabled: false });
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).rejects.toThrow(ForbiddenException);
    });

    it('rifiuta se non viene indicato né "asap" né un "requestedAt"', async () => {
      await expect(
        service.createPublicOrder('venue-1', baseOrderDto({ requestedAt: undefined })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createPublicOrder — ordine "il prima possibile" (ASAP, §5.10)', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('con il negozio aperto: parte per subito (arrotondato al quarto d\'ora), niente awaitingShopOpening', async () => {
      // Lunedì 1/1/2024, 12:45 a Roma: dentro la fascia pranzo di default
      // (12:00-15:00) con margine di 30' (12:30-14:30) — già su un quarto
      // d'ora esatto, quindi l'arrotondamento non lo sposta.
      jest.useFakeTimers().setSystemTime(new Date('2024-01-01T11:45:00.000Z'));
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, timezone: 'Europe/Rome' });

      const order = await service.createPublicOrder('venue-1', baseOrderDto({ asap: true, requestedAt: undefined }));

      expect(order.awaitingShopOpening).toBe(false);
      expect(order.requestedAt.toISOString()).toBe('2024-01-01T11:45:00.000Z');
      expect(mail.sendReceivedAwaitingOpening).not.toHaveBeenCalled();
      expect(mail.sendReceived).toHaveBeenCalled();
    });

    it('con il negozio chiuso: l\'ordine nasce comunque PENDING, awaitingShopOpening=true, mai auto-accettato, email dedicata', async () => {
      // Stesso istante di sopra, ma lunedì è chiuso: il prossimo orario
      // utile è martedì 12:30 (apertura 12:00 + margine 30').
      jest.useFakeTimers().setSystemTime(new Date('2024-01-01T11:45:00.000Z'));
      prisma.venue.findUnique.mockResolvedValue({
        ...baseVenue,
        timezone: 'Europe/Rome',
        onlineOrdersOpeningHours: [
          { dayOfWeek: 1, closed: true, slot1Start: null, slot1End: null, slot2Start: null, slot2End: null },
          { dayOfWeek: 2, closed: false, slot1Start: '12:00', slot1End: '15:00', slot2Start: null, slot2End: null },
        ],
        onlineOrdersAutoAcceptEnabled: true,
        onlineOrdersAutoAcceptPerSlot: 999,
      });

      const order = await service.createPublicOrder('venue-1', baseOrderDto({ asap: true, requestedAt: undefined }));

      expect(order.status).toBe('PENDING');
      expect(order.awaitingShopOpening).toBe(true);
      expect(order.requestedAt.toISOString()).toBe('2024-01-02T11:30:00.000Z');
      expect(mail.sendReceivedAwaitingOpening).toHaveBeenCalled();
      expect(mail.sendReceived).not.toHaveBeenCalled();
      expect(mail.sendConfirmed).not.toHaveBeenCalled();
    });
  });

  describe('createPublicOrder — carrello e prezzi', () => {
    it('ricalcola il subtotale lato server (quantità × prezzo variante)', async () => {
      await service.createPublicOrder('venue-1', baseOrderDto());
      const call = prisma.onlineOrder.create.mock.calls[0][0];
      expect(call.data.subtotal).toBe(20); // 2 × 10
      expect(call.data.total).toBe(20); // ritiro: nessuna deliveryFee
    });

    it('rifiuta una voce non orderableOnline', async () => {
      prisma.menuItemVariant.findMany.mockResolvedValue([
        { ...variantFixture, menuItem: { ...variantFixture.menuItem, orderableOnline: false } },
      ]);
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).rejects.toThrow(BadRequestException);
    });

    it('rifiuta una voce la cui categoria non è orderableOnline, anche se la voce stessa lo è (§5.10)', async () => {
      prisma.menuItemVariant.findMany.mockResolvedValue([
        {
          ...variantFixture,
          menuItem: { ...variantFixture.menuItem, category: { orderableOnline: false, visible: true } },
        },
      ]);
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).rejects.toThrow(BadRequestException);
    });

    it('rifiuta una variante disattivata', async () => {
      prisma.menuItemVariant.findMany.mockResolvedValue([{ ...variantFixture, active: false }]);
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).rejects.toThrow(BadRequestException);
    });

    it('rifiuta una voce temporaneamente esaurita (unavailableUntil futuro)', async () => {
      const future = new Date(Date.now() + 86400000);
      prisma.menuItemVariant.findMany.mockResolvedValue([
        { ...variantFixture, menuItem: { ...variantFixture.menuItem, unavailableUntil: future } },
      ]);
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).rejects.toThrow(BadRequestException);
    });

    it('rifiuta una variante a prezzo variabile (price null)', async () => {
      prisma.menuItemVariant.findMany.mockResolvedValue([{ ...variantFixture, price: null }]);
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).rejects.toThrow(BadRequestException);
    });

    it('somma il prezzo dei modificatori scelti al totale riga', async () => {
      prisma.menuModifierOption.findMany.mockResolvedValue([
        {
          id: 'mod-1',
          name: 'Formaggio extra',
          price: 1.5,
          loyverseModifierOptionId: null,
          group: { venueId: 'venue-1', active: true, items: [{ menuItemId: 'item-1' }] },
        },
      ]);
      await service.createPublicOrder('venue-1', baseOrderDto({ lines: cartDto({ modifierOptionIds: ['mod-1'] }).lines }));
      const call = prisma.onlineOrder.create.mock.calls[0][0];
      // 2 × (10 + 1.5) = 23
      expect(call.data.subtotal).toBe(23);
    });

    it('rifiuta un modificatore non applicabile a quella voce', async () => {
      prisma.menuModifierOption.findMany.mockResolvedValue([
        {
          id: 'mod-1',
          name: 'Formaggio extra',
          price: 1.5,
          loyverseModifierOptionId: null,
          group: { venueId: 'venue-1', active: true, items: [{ menuItemId: 'other-item' }] },
        },
      ]);
      await expect(
        service.createPublicOrder('venue-1', baseOrderDto({ lines: cartDto({ modifierOptionIds: ['mod-1'] }).lines })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rifiuta un modificatore il cui gruppo è stato disattivato dall\'admin, anche se applicabile a quella voce', async () => {
      prisma.menuModifierOption.findMany.mockResolvedValue([
        {
          id: 'mod-1',
          name: 'Formaggio extra',
          price: 1.5,
          loyverseModifierOptionId: null,
          group: { venueId: 'venue-1', active: false, items: [{ menuItemId: 'item-1' }] },
        },
      ]);
      await expect(
        service.createPublicOrder('venue-1', baseOrderDto({ lines: cartDto({ modifierOptionIds: ['mod-1'] }).lines })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rifiuta un ordine sotto la soglia minima configurata dall\'admin (§5.10)', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, onlineOrdersMinOrderAmount: 25 });
      // baseOrderDto ordina per un subtotale di 20 (2 × 10): sotto la soglia di 25.
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).rejects.toThrow(BadRequestException);
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).rejects.toThrow(/Ordine minimo/);
    });

    it('accetta un ordine che raggiunge esattamente la soglia minima', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, onlineOrdersMinOrderAmount: 20 });
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).resolves.toBeDefined();
    });

    it('nessun minimo (default null): un ordine di qualsiasi importo è accettato', async () => {
      await expect(service.createPublicOrder('venue-1', baseOrderDto())).resolves.toBeDefined();
    });
  });

  describe('createPublicOrder — consegna', () => {
    function deliveryDto(overrides?: Record<string, unknown>) {
      return baseOrderDto({
        fulfillment: 'DELIVERY',
        deliveryAddress: 'Via Roma 1',
        deliveryLat: 45.001,
        deliveryLng: 9.001,
        paymentMethod: 'CASH',
        ...overrides,
      });
    }

    it('rifiuta la consegna oltre il raggio massimo configurato', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, deliveryRadiusMeters: 10 });
      await expect(service.createPublicOrder('venue-1', deliveryDto({ deliveryLat: 46, deliveryLng: 10 }))).rejects.toThrow(
        ConflictException,
      );
    });

    it('applica il costo di consegna configurato', async () => {
      await service.createPublicOrder('venue-1', deliveryDto());
      const call = prisma.onlineOrder.create.mock.calls[0][0];
      expect(call.data.deliveryFee).toBe(2);
      expect(call.data.total).toBe(22); // 20 + 2
    });

    it('azzera il costo di consegna sopra la soglia gratuita', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, deliveryFreeAboveAmount: 15 });
      await service.createPublicOrder('venue-1', deliveryDto());
      const call = prisma.onlineOrder.create.mock.calls[0][0];
      expect(call.data.deliveryFee).toBe(0);
    });

    it('geocodifica l\'indirizzo se lat/lng non sono forniti dal client', async () => {
      (locationIqClient.forwardGeocode as jest.Mock).mockResolvedValue({ lat: 45.002, lng: 9.002, displayName: 'Via Roma 1' });
      await service.createPublicOrder('venue-1', deliveryDto({ deliveryLat: undefined, deliveryLng: undefined }));
      expect(locationIqClient.forwardGeocode).toHaveBeenCalledWith('Via Roma 1');
    });

    it('rifiuta se il locale non ha ancora impostato la propria posizione GPS', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, gpsLat: null, gpsLng: null });
      await expect(service.createPublicOrder('venue-1', deliveryDto())).rejects.toThrow(BadRequestException);
    });

    it('rifiuta la consegna se onlineOrdersDeliveryEnabled è false', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, onlineOrdersDeliveryEnabled: false });
      await expect(service.createPublicOrder('venue-1', deliveryDto())).rejects.toThrow(ForbiddenException);
    });
  });

  describe('initiateSumUpCheckout (§5.10)', () => {
    const delivery = { address: 'Via Roma 1', lat: 45.001, lng: 9.001 };

    it('crea il checkout usando il merchant_code letto dal profilo SumUp (POST /checkouts lo richiede)', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, sumupEnabled: true, sumupApiKeyEnc: encryptSecret('sumup-key') });
      (sumupClient.getMerchantCode as jest.Mock).mockResolvedValue('MC123');
      (sumupClient.createCheckout as jest.Mock).mockResolvedValue({
        id: 'checkout-1',
        status: 'PENDING',
        checkout_reference: 'ref-1',
        amount: 22,
        currency: 'EUR',
      });

      const result = await service.initiateSumUpCheckout('venue-1', cartDto(), nextLunchSlot().toISOString(), false, delivery);

      expect(sumupClient.getMerchantCode).toHaveBeenCalledWith('sumup-key');
      expect(sumupClient.createCheckout).toHaveBeenCalledWith(
        'sumup-key',
        expect.objectContaining({ merchantCode: 'MC123', amount: 22, currency: 'EUR' }),
      );
      expect(result).toEqual({ checkoutId: 'checkout-1', total: 22 });
    });

    it('rifiuta se SumUp non è abilitato per il locale', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, sumupEnabled: false });
      await expect(
        service.initiateSumUpCheckout('venue-1', cartDto(), nextLunchSlot().toISOString(), false, delivery),
      ).rejects.toThrow(BadRequestException);
      expect(sumupClient.getMerchantCode).not.toHaveBeenCalled();
    });

    it('traduce un errore SumUp (es. merchant_code non trovato) in un messaggio generico per il cliente', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, sumupEnabled: true, sumupApiKeyEnc: encryptSecret('sumup-key') });
      (sumupClient.getMerchantCode as jest.Mock).mockRejectedValue(
        new SumUpApiError('Il profilo SumUp non contiene un merchant_code: contatta il supporto SumUp.'),
      );
      await expect(
        service.initiateSumUpCheckout('venue-1', cartDto(), nextLunchSlot().toISOString(), false, delivery),
      ).rejects.toThrow(/non è al momento disponibile/);
      expect(sumupClient.createCheckout).not.toHaveBeenCalled();
    });
  });

  describe('createPublicOrder — accettazione automatica per fascia (§5.10)', () => {
    it('nasce CONFIRMED se auto-accept è attivo e la fascia è sotto soglia (COMBINED)', async () => {
      prisma.venue.findUnique.mockResolvedValue({
        ...baseVenue,
        onlineOrdersAutoAcceptEnabled: true,
        onlineOrdersAutoAcceptSlotMode: 'COMBINED',
        onlineOrdersAutoAcceptPerSlot: 3,
      });
      prisma.onlineOrder.count.mockResolvedValue(2);
      const order = await service.createPublicOrder('venue-1', baseOrderDto());
      expect((order as unknown as { status: string }).status).toBe('CONFIRMED');
      expect(mail.sendConfirmed).toHaveBeenCalled();
      expect(mail.sendReceived).not.toHaveBeenCalled();
    });

    it('nasce PENDING se la fascia è già alla soglia (COMBINED)', async () => {
      prisma.venue.findUnique.mockResolvedValue({
        ...baseVenue,
        onlineOrdersAutoAcceptEnabled: true,
        onlineOrdersAutoAcceptSlotMode: 'COMBINED',
        onlineOrdersAutoAcceptPerSlot: 3,
      });
      prisma.onlineOrder.count.mockResolvedValue(3);
      const order = await service.createPublicOrder('venue-1', baseOrderDto());
      expect((order as unknown as { status: string }).status).toBe('PENDING');
      expect(mail.sendReceived).toHaveBeenCalled();
    });

    it('nasce sempre PENDING se auto-accept è disattivato, indipendentemente dall\'occupazione', async () => {
      prisma.onlineOrder.count.mockResolvedValue(0);
      const order = await service.createPublicOrder('venue-1', baseOrderDto());
      expect((order as unknown as { status: string }).status).toBe('PENDING');
    });

    it('SEPARATE: usa la soglia PICKUP e conta solo gli ordini della stessa modalità', async () => {
      prisma.venue.findUnique.mockResolvedValue({
        ...baseVenue,
        onlineOrdersAutoAcceptEnabled: true,
        onlineOrdersAutoAcceptSlotMode: 'SEPARATE',
        onlineOrdersAutoAcceptPerSlotPickup: 2,
        onlineOrdersAutoAcceptPerSlotDelivery: 0,
      });
      prisma.onlineOrder.count.mockResolvedValue(1);
      const order = await service.createPublicOrder('venue-1', baseOrderDto({ fulfillment: 'PICKUP' }));
      expect((order as unknown as { status: string }).status).toBe('CONFIRMED');
      const countArgs = prisma.onlineOrder.count.mock.calls[0][0];
      expect(countArgs.where.fulfillment).toBe('PICKUP');
    });

    it('COMBINED: il conteggio non filtra per modalità', async () => {
      prisma.venue.findUnique.mockResolvedValue({
        ...baseVenue,
        onlineOrdersAutoAcceptEnabled: true,
        onlineOrdersAutoAcceptSlotMode: 'COMBINED',
        onlineOrdersAutoAcceptPerSlot: 5,
      });
      await service.createPublicOrder('venue-1', baseOrderDto());
      const countArgs = prisma.onlineOrder.count.mock.calls[0][0];
      expect(countArgs.where.fulfillment).toBeUndefined();
    });

    it('conta la fascia da 15 minuti corretta (bordo inferiore/superiore) indipendentemente dai secondi di requestedAt', async () => {
      const requestedAt = nextLunchSlot();
      requestedAt.setSeconds(37, 123); // stessi minuti, secondi/ms diversi: stessa fascia
      await service.createPublicOrder('venue-1', baseOrderDto({ requestedAt: requestedAt.toISOString() }));
      const countArgs = prisma.onlineOrder.count.mock.calls[0][0];
      const slotStart = new Date(requestedAt);
      slotStart.setSeconds(0, 0);
      slotStart.setMinutes(Math.floor(slotStart.getMinutes() / 15) * 15);
      const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);
      expect(countArgs.where.requestedAt.gte).toEqual(slotStart);
      expect(countArgs.where.requestedAt.lt).toEqual(slotEnd);
    });

    it('avvisa il locale via email quando arriva un nuovo ordine PENDING', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, email: 'locale@test.it' });
      await service.createPublicOrder('venue-1', baseOrderDto());
      expect(mail.sendVenueNotification).toHaveBeenCalledWith(
        expect.anything(),
        'Bar Test',
        'locale@test.it',
        expect.stringContaining('/online-orders'),
        true,
        null,
      );
    });

    it('non avvisa il locale se non ha un\'email configurata', async () => {
      await service.createPublicOrder('venue-1', baseOrderDto());
      expect(mail.sendVenueNotification).not.toHaveBeenCalled();
    });
  });

  describe('proposeTimeChange / confirmTimeChangeByToken (§5.10)', () => {
    const existingOrder = {
      id: 'order-1',
      venueId: 'venue-1',
      status: 'CONFIRMED',
      email: 'mario@test.it',
      manageToken: 'manage-token',
      proposedRequestedAt: null as Date | null,
      lines: [],
    };

    beforeEach(() => {
      prisma.onlineOrder.findFirst.mockResolvedValue(existingOrder);
      prisma.onlineOrder.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...existingOrder,
        ...data,
      }));
    });

    it('propone un nuovo orario senza vincoli di fascia (azione dello staff)', async () => {
      const newTime = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
      const updated = await service.proposeTimeChange(admin, 'venue-1', 'order-1', { requestedAt: newTime });
      expect((updated as unknown as { proposedRequestedAt: Date }).proposedRequestedAt.toISOString()).toBe(newTime);
      expect(mail.sendTimeChangeRequest).toHaveBeenCalled();
    });

    it('rifiuta di proporre un nuovo orario su un ordine già chiuso', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue({ ...existingOrder, status: 'REJECTED' });
      await expect(
        service.proposeTimeChange(admin, 'venue-1', 'order-1', { requestedAt: new Date().toISOString() }),
      ).rejects.toThrow(BadRequestException);
    });

    it('il cliente conferma il nuovo orario proposto dal token pubblico', async () => {
      const proposed = new Date(Date.now() + 3600 * 1000);
      prisma.onlineOrder.findUnique.mockResolvedValue({ ...existingOrder, proposedRequestedAt: proposed });
      const updated = await service.confirmTimeChangeByToken('order-1', 'manage-token');
      expect((updated as unknown as { requestedAt: Date; proposedRequestedAt: Date | null }).requestedAt).toEqual(proposed);
      expect((updated as unknown as { proposedRequestedAt: Date | null }).proposedRequestedAt).toBeNull();
    });

    it('rifiuta la conferma se non c\'è alcun nuovo orario proposto', async () => {
      prisma.onlineOrder.findUnique.mockResolvedValue({ ...existingOrder, proposedRequestedAt: null });
      await expect(service.confirmTimeChangeByToken('order-1', 'manage-token')).rejects.toThrow(BadRequestException);
    });

    it('rifiuta un token non combaciante', async () => {
      prisma.onlineOrder.findUnique.mockResolvedValue(existingOrder);
      await expect(service.confirmTimeChangeByToken('order-1', 'wrong-token')).rejects.toThrow(NotFoundException);
    });
  });

  describe('ciclo di vita staff: accept/reject/markReady/complete', () => {
    function orderFixture(overrides?: Record<string, unknown>) {
      return {
        id: 'order-1',
        venueId: 'venue-1',
        status: 'PENDING',
        fulfillment: 'PICKUP',
        email: 'mario@test.it',
        manageToken: 'manage-token',
        total: 20,
        customerId: 'customer-1',
        paymentMethod: null,
        paymentStatus: 'PENDING',
        sumupTransactionId: null,
        lines: [],
        ...overrides,
      };
    }

    beforeEach(() => {
      prisma.onlineOrder.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...orderFixture(),
        ...data,
      }));
    });

    it('accept: da PENDING a CONFIRMED, invia email al cliente', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(orderFixture());
      await service.accept(admin, 'venue-1', 'order-1');
      expect(mail.sendConfirmed).toHaveBeenCalled();
    });

    it('accept: rifiuta se l\'ordine non è PENDING', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(orderFixture({ status: 'CONFIRMED' }));
      await expect(service.accept(admin, 'venue-1', 'order-1')).rejects.toThrow(BadRequestException);
    });

    it('reject: rimborsa automaticamente un ordine pagato con SumUp', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(
        orderFixture({ paymentMethod: 'CARD_ONLINE', paymentStatus: 'PAID', sumupTransactionId: 'txn-1' }),
      );
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, sumupApiKeyEnc: encryptSecret('sumup-key') });
      (sumupClient.refund as jest.Mock).mockResolvedValue(undefined);
      await service.reject(admin, 'venue-1', 'order-1', { reason: 'Esaurito' });
      expect(sumupClient.refund).toHaveBeenCalledWith('sumup-key', 'txn-1');
      expect(mail.sendRejected).toHaveBeenCalled();
    });

    it('reject: segnala allo staff se il rimborso automatico fallisce, senza mandare l\'email al cliente', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(
        orderFixture({ paymentMethod: 'CARD_ONLINE', paymentStatus: 'PAID', sumupTransactionId: 'txn-1' }),
      );
      prisma.venue.findUnique.mockResolvedValue({ ...baseVenue, sumupApiKeyEnc: encryptSecret('sumup-key') });
      (sumupClient.refund as jest.Mock).mockRejectedValue(new Error('SumUp down'));
      await expect(service.reject(admin, 'venue-1', 'order-1', { reason: 'Esaurito' })).rejects.toThrow(BadRequestException);
      expect(mail.sendRejected).not.toHaveBeenCalled();
    });

    it('reject: nessun rimborso per un ordine pagato in contanti', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(orderFixture({ paymentMethod: 'CASH', paymentStatus: 'PENDING' }));
      await service.reject(admin, 'venue-1', 'order-1', { reason: 'Chiuso' });
      expect(sumupClient.refund).not.toHaveBeenCalled();
      expect(mail.sendRejected).toHaveBeenCalled();
    });

    it('markReady: da CONFIRMED a READY, invia email al cliente', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(orderFixture({ status: 'CONFIRMED' }));
      await service.markReady(admin, 'venue-1', 'order-1');
      expect(mail.sendReady).toHaveBeenCalled();
    });

    it('complete: per il ritiro richiede il metodo di pagamento scelto dall\'operatore', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(orderFixture({ status: 'READY', fulfillment: 'PICKUP' }));
      await expect(
        service.complete(admin, 'venue-1', 'order-1', {} as { paymentMethod?: 'CASH' | 'CARD_IN_STORE' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('complete: aggiorna la spesa totale del cliente e non tenta la sincronizzazione Loyverse se disattivata', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(orderFixture({ status: 'READY', fulfillment: 'DELIVERY' }));
      await service.complete(admin, 'venue-1', 'order-1', {});
      expect(customers.recordOnlineOrderCompleted).toHaveBeenCalledWith('customer-1', 20);
      expect(loyverseClient.createReceipt).not.toHaveBeenCalled();
    });
  });

  describe('sincronizzazione Loyverse alla chiusura (§5.10)', () => {
    function completedOrderFixture(overrides?: Record<string, unknown>) {
      return {
        id: 'order-1',
        venueId: 'venue-1',
        status: 'READY',
        fulfillment: 'DELIVERY',
        email: 'mario@test.it',
        manageToken: 'manage-token',
        total: 20,
        customerId: 'customer-1',
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        lines: [{ id: 'line-1', itemName: 'Pizza', variantId: 'variant-1', quantity: 2, unitPrice: 10, modifiers: [] }],
        ...overrides,
      };
    }

    const loyverseVenue = {
      ...baseVenue,
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('loyverse-token'),
      loyverseStoreId: 'store-1',
      loyversePaymentTypeIdCash: 'ptype-cash',
    };

    beforeEach(() => {
      prisma.venue.findUnique.mockResolvedValue(loyverseVenue);
      prisma.onlineOrder.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...completedOrderFixture(),
        ...data,
      }));
      prisma.menuItemVariant.findMany.mockResolvedValue([{ id: 'variant-1', loyverseVariantId: 'loy-variant-1' }]);
    });

    it('crea la ricevuta Loyverse con il payment_type_id mappato e il variant_id risolto', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(completedOrderFixture());
      (loyverseClient.createReceipt as jest.Mock).mockResolvedValue({ receipt_number: 'R-1' });
      const updated = await service.complete(admin, 'venue-1', 'order-1', {});
      expect(loyverseClient.createReceipt).toHaveBeenCalledWith(
        'loyverse-token',
        expect.objectContaining({
          store_id: 'store-1',
          payments: [{ payment_type_id: 'ptype-cash', money_amount: 20 }],
          line_items: [expect.objectContaining({ variant_id: 'loy-variant-1', quantity: 2, price: 10 })],
        }),
      );
      expect((updated as unknown as { loyverseReceiptId: string }).loyverseReceiptId).toBe('R-1');
    });

    it('salva un errore leggibile se il metodo di pagamento non è mappato, senza bloccare l\'ordine', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...loyverseVenue, loyversePaymentTypeIdCash: null });
      prisma.onlineOrder.findFirst.mockResolvedValue(completedOrderFixture());
      const updated = await service.complete(admin, 'venue-1', 'order-1', {});
      expect(loyverseClient.createReceipt).not.toHaveBeenCalled();
      expect((updated as unknown as { loyverseSyncError: string }).loyverseSyncError).toMatch(/non collegato a Loyverse/);
    });

    it('recupera e salva il punto vendita se Venue.loyverseStoreId non è ancora impostato', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...loyverseVenue, loyverseStoreId: null });
      prisma.onlineOrder.findFirst.mockResolvedValue(completedOrderFixture());
      (loyverseClient.listStores as jest.Mock).mockResolvedValue([{ id: 'store-auto', name: 'Sede' }]);
      (loyverseClient.createReceipt as jest.Mock).mockResolvedValue({ receipt_number: 'R-2' });
      await service.complete(admin, 'venue-1', 'order-1', {});
      expect(prisma.venue.update).toHaveBeenCalledWith({ where: { id: 'venue-1' }, data: { loyverseStoreId: 'store-auto' } });
      expect(loyverseClient.createReceipt).toHaveBeenCalledWith('loyverse-token', expect.objectContaining({ store_id: 'store-auto' }));
    });

    it('salva un errore se una voce non ha un variant_id Loyverse sincronizzato', async () => {
      prisma.menuItemVariant.findMany.mockResolvedValue([{ id: 'variant-1', loyverseVariantId: null }]);
      prisma.onlineOrder.findFirst.mockResolvedValue(completedOrderFixture());
      const updated = await service.complete(admin, 'venue-1', 'order-1', {});
      expect(loyverseClient.createReceipt).not.toHaveBeenCalled();
      expect((updated as unknown as { loyverseSyncError: string }).loyverseSyncError).toMatch(/Pizza/);
    });

    it('non tenta nulla se loyverseIntegrationEnabled è disattivato, anche con un token già salvato (nessun interruttore proprio)', async () => {
      prisma.venue.findUnique.mockResolvedValue({ ...loyverseVenue, loyverseIntegrationEnabled: false });
      prisma.onlineOrder.findFirst.mockResolvedValue(completedOrderFixture());
      await service.complete(admin, 'venue-1', 'order-1', {});
      expect(loyverseClient.createReceipt).not.toHaveBeenCalled();
      expect(loyverseClient.listStores).not.toHaveBeenCalled();
    });
  });

  describe('scontrini PDF (§5.10)', () => {
    const orderWithLines = {
      id: 'order-1',
      venueId: 'venue-1',
      fulfillment: 'DELIVERY',
      firstName: 'Mario',
      lastName: 'Rossi',
      phone: '3331234567',
      deliveryAddress: 'Via Roma 1',
      subtotal: 20,
      deliveryFee: 2,
      total: 22,
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
      lines: [
        {
          id: 'line-1',
          itemName: 'Pizza Margherita',
          variantName: '',
          quantity: 2,
          unitPrice: 10,
          note: 'senza basilico',
          modifiers: [{ optionName: 'Formaggio extra', price: 1 }],
        },
      ],
    };

    beforeEach(() => {
      prisma.onlineOrder.findFirst.mockResolvedValue(orderWithLines);
      prisma.venue.findUnique.mockResolvedValue({
        name: 'Bar Test',
        menuAddress: 'Via Milano 5',
        city: 'Milano',
        vatNumber: '12345678901',
      });
    });

    it('comanda cucina: niente prezzi, totale o indirizzo', async () => {
      await service.exportKitchenTicketPdf('venue-1', 'order-1');
      const section = pdf.buildReceiptDocument.mock.calls[0][0][0];
      const fullText = [section.title, ...section.lines].join('\n');
      expect(fullText).toContain('Pizza Margherita');
      expect(fullText).toContain('Formaggio extra');
      expect(fullText).toContain('senza basilico');
      expect(fullText).not.toMatch(/€|Via Roma/);
    });

    it('scontrino completo: prezzi, totale, indirizzo e pagamento', async () => {
      await service.exportFullReceiptPdf('venue-1', 'order-1');
      const section = pdf.buildReceiptDocument.mock.calls[0][0][0];
      const fullText = [...section.letterhead, section.title, ...section.lines, ...section.footer].join('\n');
      expect(fullText).toContain('Via Roma 1');
      expect(fullText).toContain('€22.00');
      expect(fullText).toContain('Metodo di pagamento: Contanti alla consegna');
      expect(fullText).toContain('Via Milano 5');
    });
  });
});
