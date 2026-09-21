import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { AttendanceService } from './attendance.service';
import { ClockDto } from './dto/clock.dto';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { XlsxService } from '../reports/xlsx.service';
import { PdfService } from '../reports/pdf.service';

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(
    private attendanceService: AttendanceService,
    private xlsx: XlsxService,
    private pdf: PdfService,
  ) {}

  // Dipendente: stato corrente + timbratura da QR
  @Get('me/status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.getCurrentStatus(user.userId);
  }

  @Post('clock')
  clock(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClockDto) {
    return this.attendanceService.clock(user, dto.qrToken);
  }

  // Admin: gestione QR postazioni
  @Post('qr-tokens')
  @Roles(Role.ADMIN)
  createQrToken(@CurrentUser() user: AuthenticatedUser, @Body('label') label: string) {
    return this.attendanceService.createQrToken(requireVenueId(user), label);
  }

  @Get('qr-tokens')
  @Roles(Role.ADMIN)
  listQrTokens(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.listQrTokens(requireVenueId(user));
  }

  // Admin/Manager: consultazione e correzione presenze
  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('employeeId') employeeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.attendanceService.listRecords(requireVenueId(user), { employeeId, from, to });
  }

  @Patch(':id/correct')
  @Roles(Role.ADMIN)
  correct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CorrectAttendanceDto,
  ) {
    return this.attendanceService.correctRecord(user, id, dto);
  }

  // Export report presenze
  @Get('export/xlsx')
  @Roles(Role.ADMIN, Role.MANAGER)
  async exportXlsx(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const records = await this.attendanceService.listRecords(requireVenueId(user), { from, to });
    const buffer = await this.xlsx.buildSheet(
      'Presenze',
      [
        { header: 'Dipendente', key: 'employee', width: 30 },
        { header: 'Tipo', key: 'type', width: 12 },
        { header: 'Data/ora', key: 'timestamp', width: 22 },
        { header: 'Fonte', key: 'source', width: 12 },
        { header: 'Nota', key: 'note', width: 30 },
      ],
      records.map((r) => ({
        employee: `${r.employee.firstName} ${r.employee.lastName}`,
        type: r.type === 'CLOCK_IN' ? 'Inizio' : 'Fine',
        timestamp: r.timestamp.toLocaleString('it-IT'),
        source: r.source,
        note: r.note ?? '',
      })),
    );
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="presenze.xlsx"',
    });
    res.send(buffer);
  }

  @Get('export/pdf')
  @Roles(Role.ADMIN, Role.MANAGER)
  async exportPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const records = await this.attendanceService.listRecords(requireVenueId(user), { from, to });
    const buffer = await this.pdf.buildDocument((doc) => {
      doc.fontSize(16).text('Report presenze', { align: 'center' }).moveDown();
      doc.fontSize(10);
      records.forEach((r) => {
        doc.text(
          `${r.employee.firstName} ${r.employee.lastName} — ${r.type === 'CLOCK_IN' ? 'Inizio' : 'Fine'} — ${r.timestamp.toLocaleString('it-IT')}${r.note ? ' — ' + r.note : ''}`,
        );
      });
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="presenze.pdf"',
    });
    res.send(buffer);
  }
}
