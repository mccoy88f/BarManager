import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

export interface MailSendParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Nome del locale: usato per il display name del mittente (mai per l'indirizzo, vedi technicalFrom). */
  venueName: string;
  /** Email del locale (o del cliente, a seconda di chi deve ricevere le risposte): mai usata come From. */
  replyTo?: string | null;
  cc?: string[];
}

export interface MailSendResult {
  sent: boolean;
  error?: string;
}

/**
 * Servizio email unico condiviso da tutti i moduli che inviano posta
 * (prenotazioni, ordini fornitori, ...): un solo transporter SMTP, una
 * sola definizione delle regole del mittente e del logging. Prima ogni
 * modulo aveva una propria copia quasi identica di questo codice, e un
 * fix (mittente sempre autenticato, log anche sui successi) applicato a
 * una copia restava dimenticato nell'altra — è successo davvero:
 * inventory/mail.service.ts non aveva ricevuto lo stesso fix di
 * reservations-mail.service.ts, e il bug (email accettate dal server ma
 * mai consegnate) si è ripresentato identico lì.
 */
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

  async send(params: MailSendParams): Promise<MailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.technicalFrom(params.venueName),
        to: params.to,
        cc: params.cc?.length ? params.cc : undefined,
        replyTo: params.replyTo || undefined,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });
      // Un log anche sul successo: senza, un invio "accettato" dal server
      // SMTP ma mai consegnato (es. mittente non autorizzato dal provider,
      // filtrato come spam) è indistinguibile, guardando i soli log, da un
      // invio mai nemmeno tentato.
      this.logger.log(`Email "${params.subject}" inviata a ${params.to} (messageId: ${info.messageId})`);
      return { sent: true };
    } catch (err) {
      this.logger.error(`Invio email a ${params.to} fallito: ${(err as Error).message}`);
      return { sent: false, error: (err as Error).message };
    }
  }

  /**
   * Mittente sempre fisso e autenticato (mai l'email del locale): molti
   * provider SMTP (Aruba, Register.it, Gmail/Office365 come relay, un
   * server di posta proprio come Zimbra, ecc.) rifiutano — o peggio,
   * scartano silenziosamente senza errore — un messaggio il cui header
   * From non corrisponde all'account autenticato (`SMTP_USER`), il
   * classico sintomo "nessuna email arriva e nessun errore in log".
   * L'email del locale (o del cliente), se impostata, va invece in
   * Reply-To: chi risponde raggiunge comunque il destinatario giusto, ma
   * l'invio non rischia più di essere bloccato o droppato.
   */
  private technicalFrom(venueName: string): string {
    const configured = process.env.SMTP_FROM || process.env.SMTP_USER || 'notifiche@barmanager.local';
    const address = configured.match(/<(.+)>/)?.[1] ?? configured;
    return `${venueName} <${address}>`;
  }
}
