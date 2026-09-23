import { Controller, Get, NotFoundException, Param, Patch, Post, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { resolveOpeningHours } from '../common/opening-hours/opening-hours';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ManageAcceptDto } from './dto/manage-accept.dto';
import { ManageRejectDto } from './dto/manage-reject.dto';

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

  /** Nome locale, orari di apertura e impostazioni prenotazioni: usate dal widget per precompilare i vincoli. */
  @Get('info')
  async info(@Req() req: Request, @Query('venueSlug') venueSlug?: string) {
    const venueId = await this.resolveVenueId(req, venueSlug);
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        name: true,
        reservationsEnabled: true,
        reservationHorizonDays: true,
        openingHours: true,
      },
    });
    if (!venue || !venue.reservationsEnabled) {
      throw new NotFoundException('Prenotazioni non disponibili per questo locale');
    }
    return { ...venue, openingHours: resolveOpeningHours(venue.openingHours) };
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

  /**
   * Pagina di gestione senza login (link Accetta/Rifiuta nell'email al
   * locale, §5.7): identificata dal token della prenotazione, non dal
   * sotto-dominio, quindi non serve risolvere il locale qui.
   */
  @Get(':id/manage')
  manage(@Param('id') id: string, @Query('token') token: string) {
    return this.reservationsService.getForManage(id, token);
  }

  @Patch(':id/manage/accept')
  manageAccept(@Param('id') id: string, @Body() dto: ManageAcceptDto) {
    return this.reservationsService.acceptByToken(id, dto.token, dto.tableIds);
  }

  @Patch(':id/manage/reject')
  manageReject(@Param('id') id: string, @Body() dto: ManageRejectDto) {
    return this.reservationsService.rejectByToken(id, dto.token, dto.reason);
  }

  /** Il cliente confema il nuovo orario proposto dal locale (link nell'email, §10). */
  @Patch(':id/manage/confirm-time')
  confirmTimeChange(@Param('id') id: string, @Body('token') token: string) {
    return this.reservationsService.confirmTimeChangeByToken(id, token);
  }
}
