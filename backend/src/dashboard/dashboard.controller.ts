import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('admin-summary')
  getAdminSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.getAdminSummary(requireVenueId(user), user.userId);
  }
}
