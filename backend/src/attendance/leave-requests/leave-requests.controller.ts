import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { LeaveStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../../common/decorators/current-user.decorator';
import { LeaveRequestsService } from './leave-requests.service';
import { CreateLeaveRequestDto } from '../dto/create-leave-request.dto';
import { ReviewLeaveRequestDto } from '../dto/review-leave-request.dto';

@Controller('leave-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeaveRequestsController {
  constructor(private service: LeaveRequestsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLeaveRequestDto) {
    return this.service.create(user, dto);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMine(user.userId);
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  listAll(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: LeaveStatus) {
    return this.service.listForVenue(requireVenueId(user), status);
  }

  /** Richieste approvate del locale: le vede l'admin e ogni dipendente responsabile (Employee.isManager). */
  @Get('approved')
  listApproved(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listApprovedForManager(user);
  }

  @Patch(':id/review')
  @Roles(Role.ADMIN, Role.MANAGER)
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewLeaveRequestDto,
  ) {
    return this.service.review(user, id, dto);
  }

  /** Una richiesta approvata può sempre essere eliminata dall'admin o da un responsabile. */
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
