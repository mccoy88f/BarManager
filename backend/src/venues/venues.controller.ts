import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { VenuesService } from './venues.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueHoursDto } from './dto/update-venue-hours.dto';

/** Gestione locali: esclusivamente Super Admin, salvo le rotte "me" (§5.4). */
@Controller('venues')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class VenuesController {
  constructor(private venuesService: VenuesService) {}

  @Get()
  list() {
    return this.venuesService.listAll();
  }

  @Post()
  create(@Body() dto: CreateVenueDto) {
    return this.venuesService.create(dto);
  }

  @Patch(':id/active')
  setActive(@Param('id') id: string, @Body('active') active: boolean) {
    return this.venuesService.setActive(id, active);
  }

  /** Il locale può vedere/modificare le proprie fasce orarie pranzo/cena. */
  @Get('me')
  @Roles(Role.ADMIN, Role.MANAGER)
  getOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.venuesService.getOwn(requireVenueId(user));
  }

  @Patch('me/hours')
  @Roles(Role.ADMIN)
  updateOwnHours(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateVenueHoursDto) {
    return this.venuesService.updateHours(requireVenueId(user), dto);
  }
}
