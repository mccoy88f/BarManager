import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PrinterUsage, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { HaccpService } from './haccp.service';
import { CreateFridgeDto } from './dto/create-fridge.dto';
import { CreateReadingDto } from './dto/create-reading.dto';
import { PrintingService } from '../printing/printing.service';
import { PdfService } from '../reports/pdf.service';

@Controller('haccp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HaccpController {
  constructor(
    private haccpService: HaccpService,
    private printing: PrintingService,
    private pdf: PdfService,
  ) {}

  @Post('fridges')
  @Roles(Role.ADMIN)
  createFridge(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFridgeDto) {
    return this.haccpService.createFridge(requireVenueId(user), dto);
  }

  @Get('fridges')
  listFridges(@CurrentUser() user: AuthenticatedUser) {
    return this.haccpService.listFridges(requireVenueId(user));
  }

  @Post('readings')
  createReading(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReadingDto) {
    return this.haccpService.createReading(user, dto);
  }

  @Get('readings')
  listReadings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.haccpService.listReadings(requireVenueId(user), from, to);
  }

  /** Stampa il report giornaliero su stampante POS Epson e registra la firma. */
  @Post('report/print')
  @Roles(Role.ADMIN, Role.MANAGER)
  async printReport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { reportDate: string; signedByName: string },
  ) {
    const venueId = requireVenueId(user);
    const readings = await this.haccpService.listReadings(venueId, body.reportDate, body.reportDate);

    const lines = readings.map(
      (r) =>
        `${r.fridge.label.padEnd(20)} ${r.value}°C ${r.outOfRange ? '[FUORI SOGLIA]' : ''} - ${r.recordedAt.toLocaleTimeString('it-IT')}`,
    );

    const result = await this.printing.printReport(venueId, PrinterUsage.HACCP, {
      title: `Report HACCP - ${new Date(body.reportDate).toLocaleDateString('it-IT')}`,
      lines,
      footer: [`Firmato da: ${body.signedByName}`, '', '_________________________'],
    });

    const report = await this.haccpService.signReport(venueId, {
      reportDate: body.reportDate,
      signedByName: body.signedByName,
      printedOnPos: result.printed,
    });

    return { report, print: result };
  }

  /** Alternativa 100% digitale: PDF con firma a video (immagine base64). */
  @Post('report/sign-digital')
  @Roles(Role.ADMIN, Role.MANAGER)
  async signDigital(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Body() body: { reportDate: string; signedByName: string; signatureImg: string },
  ) {
    const venueId = requireVenueId(user);
    const readings = await this.haccpService.listReadings(venueId, body.reportDate, body.reportDate);

    await this.haccpService.signReport(venueId, {
      reportDate: body.reportDate,
      signedByName: body.signedByName,
      signatureImg: body.signatureImg,
      printedOnPos: false,
    });

    const buffer = await this.pdf.buildDocument((doc) => {
      doc.fontSize(16).text('Report HACCP - Temperature', { align: 'center' }).moveDown();
      doc.fontSize(10);
      readings.forEach((r) => {
        doc.text(
          `${r.fridge.label} — ${r.value}°C ${r.outOfRange ? '(FUORI SOGLIA: ' + r.correctiveAction + ')' : ''} — ${r.recordedAt.toLocaleString('it-IT')}`,
        );
      });
      doc.moveDown().text(`Firmato da: ${body.signedByName}`);
      if (body.signatureImg?.startsWith('data:image')) {
        const base64 = body.signatureImg.split(',')[1];
        doc.image(Buffer.from(base64, 'base64'), { width: 150 });
      }
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="haccp-report.pdf"',
    });
    res.send(buffer);
  }

  @Get('reports')
  @Roles(Role.ADMIN, Role.MANAGER)
  listReports(@CurrentUser() user: AuthenticatedUser) {
    return this.haccpService.listReports(requireVenueId(user));
  }
}
