import { Controller, Get, NotFoundException, Post, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

/**
 * Widget pubblico di prenotazione, nessun login: risolto dal sotto-dominio
 * (TenantMiddleware). In sviluppo locale, senza sotto-domini, si può
 * passare `?venueSlug=...` (stesso schema di public/menu).
 */
@Controller('public/reservations')
export class PublicReservationsController {
  constructor(
    private reservationsService: ReservationsService,
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

  /** Nome locale, fasce orarie e impostazioni prenotazioni: usate dal widget per precompilare i vincoli. */
  @Get('info')
  async info(@Req() req: Request, @Query('venueSlug') venueSlug?: string) {
    const venueId = await this.resolveVenueId(req, venueSlug);
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        name: true,
        reservationsEnabled: true,
        reservationHorizonDays: true,
        lunchStart: true,
        lunchEnd: true,
        dinnerStart: true,
        dinnerEnd: true,
      },
    });
    if (!venue || !venue.reservationsEnabled) {
      throw new NotFoundException('Prenotazioni non disponibili per questo locale');
    }
    return venue;
  }

  @Get('availability')
  async availability(
    @Req() req: Request,
    @Query('reservedAt') reservedAt: string,
    @Query('venueSlug') venueSlug?: string,
  ) {
    const venueId = await this.resolveVenueId(req, venueSlug);
    return this.reservationsService.getAvailability(venueId, reservedAt);
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body() dto: CreateReservationDto,
    @Query('venueSlug') venueSlug?: string,
  ) {
    const venueId = await this.resolveVenueId(req, venueSlug);
    return this.reservationsService.createPublicReservation(venueId, dto);
  }
}
