import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
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

/** Coda prenotazioni, lato admin/manager autorizzato (§5.7). */
@Controller('reservations')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('reservations')
export class ReservationsController {
  constructor(private reservationsService: ReservationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: ReservationStatus) {
    return this.reservationsService.listReservations(requireVenueId(user), status);
  }

  /** Posti disponibili per un orario/party size dato, per il conteggio sempre visibile in coda. */
  @Get('availability')
  availability(@CurrentUser() user: AuthenticatedUser, @Query('reservedAt') reservedAt: string) {
    return this.reservationsService.getAvailability(requireVenueId(user), reservedAt);
  }

  @Patch(':id/accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AcceptReservationDto,
  ) {
    return this.reservationsService.accept(user, requireVenueId(user), id, dto.tableId);
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
    return this.reservationsService.reassignTable(requireVenueId(user), id, dto.tableId);
  }
}
