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
    venueName: string;
    replyTo?: string | null;
  }): Promise<{ sent: boolean; error?: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: this.technicalFrom(params.venueName),
        to: params.to,
        cc: params.cc.length ? params.cc : undefined,
        replyTo: params.replyTo || undefined,
        subject: params.subject,
        text: params.text,
      });
      // Un log anche sul successo: senza, un invio "accettato" dal server
      // SMTP ma mai consegnato (es. mittente non autorizzato dal provider)
      // è indistinguibile, guardando i soli log, da un invio mai tentato.
      this.logger.log(`Email ordine "${params.subject}" inviata a ${params.to} (messageId: ${info.messageId})`);
      return { sent: true };
    } catch (err) {
      this.logger.error(`Invio email ordine a ${params.to} fallito: ${(err as Error).message}`);
      return { sent: false, error: (err as Error).message };
    }
  }

  /**
   * Mittente sempre fisso e autenticato (mai l'email del locale): stesso
   * principio di reservations-mail.service.ts — molti provider SMTP
   * rifiutano o scartano silenziosamente un messaggio il cui From non
   * corrisponde all'account autenticato (`SMTP_USER`). L'email del
   * locale, se impostata, va invece in Reply-To: il fornitore che
   * risponde raggiunge comunque il locale, ma l'invio non rischia più di
   * essere bloccato o droppato.
   */
  private technicalFrom(venueName: string): string {
    const configured = process.env.SMTP_FROM || process.env.SMTP_USER || 'ordini@barmanager.local';
    const address = configured.match(/<(.+)>/)?.[1] ?? configured;
    return `${venueName} <${address}>`;
  }
}
