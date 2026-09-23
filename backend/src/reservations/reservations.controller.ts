import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ReservationStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { ReservationsService } from './reservations.service';
import { RejectReservationDto } from './dto/reject-reservation.dto';
import { AcceptReservationDto } from './dto/accept-reservation.dto';
import { AssignTableDto } from './dto/assign-table.dto';
import { CreateManualReservationDto } from './dto/create-manual-reservation.dto';
import { ProposeTimeChangeDto } from './dto/propose-time-change.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';

/** Coda prenotazioni, lato admin/manager autorizzato (§5.7). */
@Controller('reservations')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('reservations')
export class ReservationsController {
  constructor(private reservationsService: ReservationsService) {}

  /**
   * `withoutTable=true` ignora `status` e restituisce la coda delle
   * prenotazioni attive senza tavolo assegnato, qualunque sia il loro
   * stato (PENDING dal widget pubblico o CONFIRMED aggiunte a mano).
   */
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: ReservationStatus,
    @Query('withoutTable') withoutTable?: string,
  ) {
    return this.reservationsService.listReservations(requireVenueId(user), status, withoutTable === 'true');
  }

  /** Posti disponibili per un orario/party size dato, per il conteggio sempre visibile in coda. */
  @Get('availability')
  availability(@CurrentUser() user: AuthenticatedUser, @Query('reservedAt') reservedAt: string) {
    return this.reservationsService.getAvailability(requireVenueId(user), reservedAt);
  }

  /** Clienti già prenotati che combaciano con la ricerca, per "pescare" i dati in fase di aggiunta manuale. */
  @Get('customers/search')
  searchCustomers(@CurrentUser() user: AuthenticatedUser, @Query('query') query?: string) {
    return this.reservationsService.searchCustomers(requireVenueId(user), query ?? '');
  }

  /** Storico completo di un cliente (per email), per il pulsante "storico cliente". */
  @Get('customers/history')
  customerHistory(@CurrentUser() user: AuthenticatedUser, @Query('email') email: string) {
    return this.reservationsService.getCustomerHistory(requireVenueId(user), email);
  }

  /** Tavoli attivi con indicazione di quali sono occupati per un orario/durata dati (dialog di aggiunta manuale). */
  @Get('table-availability')
  tableAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Query('reservedAt') reservedAt: string,
    @Query('durationMinutes') durationMinutes?: string,
  ) {
    return this.reservationsService.getTableAvailability(
      requireVenueId(user),
      reservedAt,
      durationMinutes ? Number(durationMinutes) : undefined,
    );
  }

  /** Aggiunta manuale in backoffice (telefono, di persona, ...): nessun vincolo di disponibilità, tavolo opzionale. */
  @Post('manual')
  createManual(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateManualReservationDto) {
    return this.reservationsService.createManualReservation(user, requireVenueId(user), dto);
  }

  @Patch(':id/accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AcceptReservationDto,
  ) {
    return this.reservationsService.accept(user, requireVenueId(user), id, dto.tableIds);
  }

  @Patch(':id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectReservationDto,
  ) {
    return this.reservationsService.reject(user, requireVenueId(user), id, dto);
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reservationsService.cancel(user, requireVenueId(user), id);
  }

  @Patch(':id/table')
  reassignTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignTableDto,
  ) {
    return this.reservationsService.reassignTables(requireVenueId(user), id, dto.tableIds ?? []);
  }

  /** Propone un nuovo orario al cliente (all'accettazione o dopo): non cambia subito la prenotazione, chiede conferma via email. */
  @Patch(':id/time')
  proposeTimeChange(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ProposeTimeChangeDto,
  ) {
    return this.reservationsService.proposeTimeChange(user, requireVenueId(user), id, dto);
  }

  /** Modifica generale (dati cliente, note, durata di occupazione): non richiede conferma del cliente. */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateReservationDto,
  ) {
    return this.reservationsService.updateReservation(user, requireVenueId(user), id, dto);
  }
}
