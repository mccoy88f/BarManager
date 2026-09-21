import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import { CreatePrinterDto } from './dto/create-printer.dto';
import { UpdatePrinterDto } from './dto/update-printer.dto';

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
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePrinterDto) {
    return this.prisma.printer.create({
      data: { ...dto, venueId: requireVenueId(user) },
    });
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePrinterDto,
  ) {
    await this.assertOwnership(requireVenueId(user), id);
    return this.prisma.printer.update({ where: { id }, data: dto });
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.assertOwnership(requireVenueId(user), id);
    await this.prisma.printer.delete({ where: { id } });
    return { success: true };
  }

  private async assertOwnership(venueId: string, printerId: string) {
    const printer = await this.prisma.printer.findUnique({ where: { id: printerId } });
    if (!printer || printer.venueId !== venueId) {
      throw new NotFoundException('Stampante non trovata');
    }
    return printer;
  }
}
