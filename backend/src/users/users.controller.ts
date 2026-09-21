import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findAllForVenue(requireVenueId(user));
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEmployeeDto) {
    return this.usersService.createEmployee(requireVenueId(user), dto);
  }

  @Patch(':id/active')
  @Roles(Role.ADMIN)
  setActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('active') active: boolean,
  ) {
    return this.usersService.setActive(requireVenueId(user), id, active);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.usersService.updateEmployee(requireVenueId(user), id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.removeEmployee(requireVenueId(user), id);
  }
}
