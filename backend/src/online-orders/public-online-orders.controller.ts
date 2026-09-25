import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { resolveOpeningHours } from '../common/opening-hours/opening-hours';
import { locationIqClient } from '../common/geo/locationiq-client';
import { OnlineOrdersService } from './online-orders.service';
import { CreateOnlineOrderDto } from './dto/create-online-order.dto';
import { CartDto } from './dto/cart-line.dto';

/**
 * Pagina pubblica di ordinazione /ordina, nessun login: risolta dal
 * sotto-dominio (TenantMiddleware), con lo stesso fallback `?venueSlug=`
 * usato da /public/menu e /public/reservations per lo sviluppo locale.
 */
@Controller('public/online-orders')
export class PublicOnlineOrdersController {
  constructor(
    private onlineOrdersService: OnlineOrdersService,
    private prisma: PrismaService,
  ) {}

  private async resolveVenueId(req: Request, venueSlug?: string): Promise<string> {
    let venueId = req.venue?.id;
    if (!venueId && venueSlug) {
      const venue = await this.prisma.venue.findFirst({ where: { slug: venueSlug, active: true } });
      venueId = venue?.id;
    }
    if (!venueId) throw new NotFoundException('Locale non trovato');
    return venueId;
  }

  /** Impostazioni pubbliche usate dal checkout: orari, modalità disponibili, costi di consegna, metodi carta abilitati. */
  @Get('info')
  async info(@Req() req: Request, @Query('venueSlug') venueSlug?: string) {
    const venueId = await this.resolveVenueId(req, venueSlug);
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        name: true,
        onlineOrdersEnabled: true,
        onlineOrdersPickupEnabled: true,
        onlineOrdersDeliveryEnabled: true,
        onlineOrdersOpeningHours: true,
        openingHours: true,
        onlineOrdersMinLeadMinutes: true,
        deliveryRadiusMeters: true,
        deliveryFee: true,
        deliveryFreeAboveAmount: true,
        sumupEnabled: true,
        sumupEnabledPaymentMethods: true,
        menuAddress: true,
        city: true,
        menuPhone: true,
      },
    });
    if (!venue || !venue.onlineOrdersEnabled) {
      throw new NotFoundException('Ordini online non disponibili per questo locale');
    }
    return { ...venue, openingHours: resolveOpeningHours(venue.onlineOrdersOpeningHours ?? venue.openingHours) };
  }

  /** Solo le voci di menù ordinabili online, con varianti e gruppi di modificatori. */
  @Get('menu')
  async menu(@Req() req: Request, @Query('venueSlug') venueSlug?: string) {
    const venueId = await this.resolveVenueId(req, venueSlug);
    const categories = await this.prisma.menuCategory.findMany({
      where: {
        venueId,
        visible: true,
        orderableOnline: true,
        items: { some: { orderableOnline: true, visible: true } },
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { orderableOnline: true, visible: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            variants: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
            modifierGroups: {
              where: { modifierGroup: { active: true } },
              include: { modifierGroup: { include: { options: { orderBy: { sortOrder: 'asc' } } } } },
            },
          },
        },
      },
    });
    return categories;
  }

  /**
   * Proxy verso LocationIQ (indirizzo -> coordinate, §5.10): la chiave API
   * resta lato server, mai esposta al browser. Usato dal pulsante "Cerca"
   * nel checkout consegna, prima di posizionare il puntatore sulla mappa.
   */
  @Get('geocode')
  geocode(@Query('address') address: string) {
    return locationIqClient.forwardGeocode(address);
  }

  /** Coordinate -> indirizzo leggibile, quando il cliente sposta il puntatore a mano sulla mappa. */
  @Get('reverse-geocode')
  reverseGeocode(@Query('lat') lat: string, @Query('lng') lng: string) {
    return locationIqClient.reverseGeocode(Number(lat), Number(lng));
  }

  @Post('sumup-checkout')
  sumupCheckout(
    @Req() req: Request,
    @Body()
    body: {
      cart: CartDto;
      requestedAt?: string;
      asap?: boolean;
      deliveryAddress?: string;
      deliveryLat?: number;
      deliveryLng?: number;
    },
    @Query('venueSlug') venueSlug?: string,
  ) {
    return this.resolveVenueId(req, venueSlug).then((venueId) =>
      this.onlineOrdersService.initiateSumUpCheckout(venueId, body.cart, body.requestedAt, body.asap ?? false, {
        address: body.deliveryAddress,
        lat: body.deliveryLat,
        lng: body.deliveryLng,
      }),
    );
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body() dto: CreateOnlineOrderDto,
    @Query('venueSlug') venueSlug?: string,
  ) {
    const venueId = await this.resolveVenueId(req, venueSlug);
    return this.onlineOrdersService.createPublicOrder(venueId, dto);
  }

  /** Pagina pubblica di tracciamento ordine, nessun login (link mandato al cliente). */
  @Get(':id/manage')
  manage(@Param('id') id: string, @Query('token') token: string) {
    return this.onlineOrdersService.getForManage(id, token);
  }

  /** Il cliente conferma il nuovo orario proposto dallo staff. */
  @Patch(':id/manage/confirm-time')
  confirmTimeChange(@Param('id') id: string, @Body('token') token: string) {
    return this.onlineOrdersService.confirmTimeChangeByToken(id, token);
  }
}
