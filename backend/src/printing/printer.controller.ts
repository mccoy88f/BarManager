import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/** CRUD stampanti di rete configurate dall'amministratore. */
@Controller('printers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PrinterController {
  constructor(private prisma: PrismaService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.printer.findMany({ where: { venueId: requireVenueId(user) } });
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string; host: string; port?: number; usage: 'HACCP' | 'ORDERS' | 'GENERIC' },
  ) {
    return this.prisma.printer.create({
      data: {
        name: body.name,
        host: body.host,
        port: body.port ?? 9100,
        usage: body.usage,
        venueId: requireVenueId(user),
      },
    });
  }
}
