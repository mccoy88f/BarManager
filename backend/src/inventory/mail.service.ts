import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });

  async sendOrderEmail(params: {
    to: string;
    cc: string[];
    subject: string;
    text: string;
  }): Promise<{ sent: boolean; error?: string }> {
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || 'ordini@barmanager.local',
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
