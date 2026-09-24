import {
  Body,
  Controller,
  Delete,
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
import { Throttle } from '@nestjs/throttler';
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
import { CreateNfcTagDto } from './dto/create-nfc-tag.dto';
import { AddAttendanceRecordDto } from './dto/add-attendance-record.dto';
import { SelfReportAttendanceDto } from './dto/self-report-attendance.dto';
import { buildAttendanceSummary, formatHoursHHMM } from './attendance-summary.util';
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

  /** Storico delle proprie timbrature, se l'admin lo ha abilitato per il locale. */
  @Get('me/history')
  getOwnHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.getOwnHistory(user.userId);
  }

  /** Quali metodi di timbratura verificata sono abilitati (mai le coordinate esatte). */
  @Get('clock-in-settings')
  getClockInSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.getClockInSettings(requireVenueId(user));
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('clock')
  clock(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClockDto) {
    return this.attendanceService.clock(user, dto);
  }

  /** "Ho dimenticato di timbrare": resta in attesa finché l'admin non la rivede. */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('self-report')
  selfReport(@CurrentUser() user: AuthenticatedUser, @Body() dto: SelfReportAttendanceDto) {
    return this.attendanceService.selfReport(user, dto);
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

  @Patch('qr-tokens/:id')
  @Roles(Role.ADMIN)
  updateQrToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('label') label: string,
  ) {
    return this.attendanceService.updateQrToken(requireVenueId(user), id, label);
  }

  @Delete('qr-tokens/:id')
  @Roles(Role.ADMIN)
  removeQrToken(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.attendanceService.removeQrToken(requireVenueId(user), id);
  }

  // Admin: gestione tag NFC
  @Post('nfc-tags')
  @Roles(Role.ADMIN)
  createNfcTag(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNfcTagDto) {
    return this.attendanceService.createNfcTag(requireVenueId(user), dto);
  }

  @Get('nfc-tags')
  @Roles(Role.ADMIN)
  listNfcTags(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.listNfcTags(requireVenueId(user));
  }

  @Patch('nfc-tags/:id')
  @Roles(Role.ADMIN)
  updateNfcTag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateNfcTagDto,
  ) {
    return this.attendanceService.updateNfcTag(requireVenueId(user), id, dto);
  }

  @Delete('nfc-tags/:id')
  @Roles(Role.ADMIN)
  removeNfcTag(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.attendanceService.removeNfcTag(requireVenueId(user), id);
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

  // Solo l'admin aggiunge/elimina timbrature per conto di un dipendente
  // (mai per sé stesso: l'admin non traccia la propria presenza).
  @Post()
  @Roles(Role.ADMIN)
  addRecord(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddAttendanceRecordDto) {
    return this.attendanceService.addRecord(user, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  deleteRecord(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.attendanceService.deleteRecord(user, id);
  }

  /** Timbrature "ho dimenticato di timbrare" in attesa di conferma. */
  @Get('pending')
  @Roles(Role.ADMIN)
  listPending(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.listPending(requireVenueId(user));
  }

  @Patch(':id/review')
  @Roles(Role.ADMIN)
  reviewSelfReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('approve') approve: boolean,
  ) {
    return this.attendanceService.reviewSelfReport(user, id, approve);
  }

  // Export report presenze: una riga per turno (inizio+fine abbinati), ore
  // decimali/centesimali, totale giornaliero e totale finale per dipendente,
  // metodo e riferimento (QR/NFC/GPS) di inizio e fine. Solo le timbrature
  // confermate concorrono al calcolo (vedi buildAttendanceSummary).
  @Get('export/xlsx')
  @Roles(Role.ADMIN, Role.MANAGER)
  async exportXlsx(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Query('employeeId') employeeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const records = await this.attendanceService.listRecords(requireVenueId(user), { employeeId, from, to });
    const summaries = buildAttendanceSummary(records);

    const rows: Record<string, unknown>[] = [];
    for (const employee of summaries) {
      for (const day of employee.days) {
        for (const shift of day.shifts) {
          rows.push({
            employee: employee.employeeName,
            date: shift.date,
            clockIn: shift.clockIn
              ? shift.clockIn.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
              : '—',
            methodIn: shift.methodIn,
            clockOut: shift.clockOut
              ? shift.clockOut.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
              : '—',
            methodOut: shift.methodOut,
            hoursHHMM: shift.hours != null ? formatHoursHHMM(shift.hours) : '—',
            hoursDecimal: shift.hours != null ? shift.hours.toFixed(2) : '—',
            note: shift.note,
          });
        }
        rows.push({
          employee: '',
          date: `Totale ${day.date}`,
          clockIn: '',
          methodIn: '',
          clockOut: '',
          methodOut: '',
          hoursHHMM: formatHoursHHMM(day.dailyTotalHours),
          hoursDecimal: day.dailyTotalHours.toFixed(2),
          note: '',
        });
      }
      rows.push({
        employee: `Totale ${employee.employeeName}`,
        date: '',
        clockIn: '',
        methodIn: '',
        clockOut: '',
        methodOut: '',
        hoursHHMM: formatHoursHHMM(employee.grandTotalHours),
        hoursDecimal: employee.grandTotalHours.toFixed(2),
        note: '',
      });
    }

    const buffer = await this.xlsx.buildSheet(
      'Presenze',
      [
        { header: 'Dipendente', key: 'employee', width: 30 },
        { header: 'Data', key: 'date', width: 14 },
        { header: 'Inizio', key: 'clockIn', width: 10 },
        { header: 'Metodo inizio', key: 'methodIn', width: 26 },
        { header: 'Fine', key: 'clockOut', width: 10 },
        { header: 'Metodo fine', key: 'methodOut', width: 26 },
        { header: 'Ore (hh:mm)', key: 'hoursHHMM', width: 12 },
        { header: 'Ore (decimali)', key: 'hoursDecimal', width: 14 },
        { header: 'Nota', key: 'note', width: 30 },
      ],
      rows,
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
    @Query('employeeId') employeeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const records = await this.attendanceService.listRecords(requireVenueId(user), { employeeId, from, to });
    const summaries = buildAttendanceSummary(records);

    const buffer = await this.pdf.buildDocument((doc) => {
      doc.fontSize(16).text('Report presenze', { align: 'center' }).moveDown();
      doc.fontSize(10);
      for (const employee of summaries) {
        doc.fontSize(12).text(employee.employeeName, { underline: true }).moveDown(0.3);
        doc.fontSize(9);
        for (const day of employee.days) {
          doc.text(day.date, { continued: false });
          for (const shift of day.shifts) {
            const inTime = shift.clockIn
              ? shift.clockIn.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
              : '—';
            const outTime = shift.clockOut
              ? shift.clockOut.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
              : '—';
            const hours =
              shift.hours != null
                ? `${formatHoursHHMM(shift.hours)} h (${shift.hours.toFixed(2)})`
                : '—';
            doc.text(
              `   ${inTime} (${shift.methodIn}) → ${outTime} (${shift.methodOut}) — ${hours}${shift.note ? ' — ' + shift.note : ''}`,
            );
          }
          doc.text(
            `   Totale giornata: ${formatHoursHHMM(day.dailyTotalHours)} h (${day.dailyTotalHours.toFixed(2)})`,
          );
        }
        doc
          .fontSize(11)
          .text(
            `Totale ${employee.employeeName}: ${formatHoursHHMM(employee.grandTotalHours)} h (${employee.grandTotalHours.toFixed(2)})`,
          )
          .moveDown();
        doc.fontSize(9);
      }
      if (summaries.length === 0) {
        doc.text('Nessuna timbratura confermata nel periodo selezionato.');
      }
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="presenze.pdf"',
    });
    res.send(buffer);
  }
}
