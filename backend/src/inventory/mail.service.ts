import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    // La 465 è SMTPS (connessione TLS diretta), le altre porte (587, 25) usano
    // STARTTLS: nodemailer non lo deduce da solo dalla porta, va indicato.
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === 'true'
      : Number(process.env.SMTP_PORT) === 465,
    // SMTP_PASS accettata come alias di SMTP_PASSWORD: un nome sbagliato qui
    // non fa fallire l'invio con un errore poco chiaro ("Missing credentials
    // for PLAIN"), fa solo mancare l'autenticazione in silenzio finché non
    // si prova a inviare.
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS }
      : undefined,
  });

  async sendOrderEmail(params: {
    to: string;
    cc: string[];
    subject: string;
    text: string;
    from?: string | null;
  }): Promise<{ sent: boolean; error?: string }> {
    try {
      await this.transporter.sendMail({
        from: params.from || process.env.SMTP_FROM || 'ordini@barmanager.local',
        to: params.to,
        cc: params.cc.length ? params.cc : undefined,
        subject: params.subject,
        text: params.text,
      });
      return { sent: true };
    } catch (err) {
      this.logger.error(`Invio email ordine fallito: ${(err as Error).message}`);
      return { sent: false, error: (err as Error).message };
    }
  }
}
