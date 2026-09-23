import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { Reservation } from '@prisma/client';

/**
 * Email al cliente sull'esito della sua richiesta di prenotazione. Stessa
 * configurazione SMTP di inventory/mail.service.ts (variabili d'ambiente
 * condivise): un locale non deve configurare due volte l'invio email.
 */
@Injectable()
export class ReservationsMailService {
  private readonly logger = new Logger(ReservationsMailService.name);
  private transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === 'true'
      : Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS }
      : undefined,
  });

  private async send(params: {
    to: string;
    subject: string;
    text: string;
    from?: string | null;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: params.from || process.env.SMTP_FROM || 'prenotazioni@barmanager.local',
        to: params.to,
        subject: params.subject,
        text: params.text,
      });
    } catch (err) {
      this.logger.error(`Invio email prenotazione fallito: ${(err as Error).message}`);
    }
  }

  private fromAddress(venueName: string, venueEmail?: string | null): string | undefined {
    return venueEmail ? `${venueName} <${venueEmail}>` : undefined;
  }

  private when(reservedAt: Date): string {
    return `${reservedAt.toLocaleDateString('it-IT')} alle ${reservedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  }

  sendReceived(reservation: Reservation, venueName: string, venueEmail?: string | null) {
    return this.send({
      to: reservation.email,
      subject: `${venueName} — richiesta di prenotazione ricevuta`,
      text: `Ciao ${reservation.firstName},\n\nabbiamo ricevuto la tua richiesta di prenotazione per ${reservation.partySize} persone il ${this.when(reservation.reservedAt)}.\nTi confermeremo a breve la disponibilità.\n\nGrazie,\n${venueName}`,
      from: this.fromAddress(venueName, venueEmail),
    });
  }

  sendConfirmed(reservation: Reservation, venueName: string, venueEmail?: string | null) {
    return this.send({
      to: reservation.email,
      subject: `${venueName} — prenotazione confermata`,
      text: `Ciao ${reservation.firstName},\n\nla tua prenotazione per ${reservation.partySize} persone il ${this.when(reservation.reservedAt)} è confermata.\n\nTi aspettiamo,\n${venueName}`,
      from: this.fromAddress(venueName, venueEmail),
    });
  }

  sendRejected(
    reservation: Reservation,
    venueName: string,
    reason: string,
    venueEmail?: string | null,
  ) {
    return this.send({
      to: reservation.email,
      subject: `${venueName} — prenotazione non confermata`,
      text: `Ciao ${reservation.firstName},\n\nnon possiamo confermare la tua prenotazione per ${reservation.partySize} persone il ${this.when(reservation.reservedAt)}.\nMotivo: ${reason}\n\n${venueName}`,
      from: this.fromAddress(venueName, venueEmail),
    });
  }
}
