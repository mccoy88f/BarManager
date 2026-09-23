import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { Reservation } from '@prisma/client';

/** Sfugge i campi inseriti dal cliente prima di iniettarli nell'HTML dell'email al locale. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Email al cliente sull'esito della sua richiesta di prenotazione, ed email
 * al locale su ogni nuova richiesta (con pulsanti Accetta/Rifiuta). Stessa
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
    html?: string;
    from?: string | null;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: params.from || process.env.SMTP_FROM || 'prenotazioni@barmanager.local',
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
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

  /** Annullamento da parte del locale (es. il cliente disdice per telefono, o l'admin corregge un errore). */
  sendCancelled(reservation: Reservation, venueName: string, venueEmail?: string | null) {
    return this.send({
      to: reservation.email,
      subject: `${venueName} — prenotazione annullata`,
      text: `Ciao ${reservation.firstName},\n\nla tua prenotazione per ${reservation.partySize} persone il ${this.when(reservation.reservedAt)} è stata annullata.\nSe pensi sia un errore, contattaci direttamente.\n\n${venueName}`,
      from: this.fromAddress(venueName, venueEmail),
    });
  }

  /**
   * Ogni nuova prenotazione avvisa l'email del locale (Impostazioni
   * locale): con i pulsanti Accetta/Rifiuta se serve conferma manuale
   * (`needsAction`), solo informativa se è già stata confermata in
   * automatico. I pulsanti puntano alla pagina pubblica di gestione
   * (`manageUrl`, protetta dal token della prenotazione), non eseguono
   * l'azione al solo apertura del link: evita che uno scanner email che
   * "visita" i link in automatico confermi o rifiuti la prenotazione da
   * solo.
   */
  sendVenueNotification(
    reservation: Reservation,
    venueName: string,
    venueEmail: string,
    manageUrl: string,
    needsAction: boolean,
  ) {
    const detailLines = [
      `${reservation.firstName} ${reservation.lastName} — ${reservation.partySize} persone`,
      this.when(reservation.reservedAt),
      `Email: ${reservation.email} — Telefono: ${reservation.phone}`,
      ...(reservation.isEvent ? [`Occasione speciale: ${reservation.eventNote || '-'}`] : []),
      ...(reservation.allergiesNote ? [`Allergie/intolleranze: ${reservation.allergiesNote}`] : []),
      ...(reservation.notes ? [`Note: ${reservation.notes}`] : []),
    ];

    const text = [
      needsAction ? 'Nuova prenotazione da confermare:' : 'Nuova prenotazione (confermata in automatico):',
      '',
      ...detailLines,
      '',
      needsAction ? `Gestisci la richiesta: ${manageUrl}` : `Dettagli: ${manageUrl}`,
    ].join('\n');

    const detailHtml = [
      `<p><strong>${escapeHtml(reservation.firstName)} ${escapeHtml(reservation.lastName)}</strong> — ${reservation.partySize} persone</p>`,
      `<p>${escapeHtml(this.when(reservation.reservedAt))}</p>`,
      `<p>Email: ${escapeHtml(reservation.email)}<br/>Telefono: ${escapeHtml(reservation.phone)}</p>`,
      ...(reservation.isEvent
        ? [`<p>Occasione speciale: ${escapeHtml(reservation.eventNote || '-')}</p>`]
        : []),
      ...(reservation.allergiesNote
        ? [`<p>Allergie/intolleranze: ${escapeHtml(reservation.allergiesNote)}</p>`]
        : []),
      ...(reservation.notes ? [`<p>Note: ${escapeHtml(reservation.notes)}</p>`] : []),
    ].join('\n');

    const actionsHtml = needsAction
      ? `<div style="margin-top:16px;">
          <a href="${manageUrl}&action=accept" style="display:inline-block;background:#2e7d32;color:#fff;padding:10px 22px;border-radius:4px;text-decoration:none;font-weight:bold;margin-right:10px;">Accetta</a>
          <a href="${manageUrl}&action=reject" style="display:inline-block;background:#c62828;color:#fff;padding:10px 22px;border-radius:4px;text-decoration:none;font-weight:bold;">Rifiuta</a>
        </div>`
      : `<p><a href="${manageUrl}">Vedi i dettagli</a></p>`;

    const html = `
      <div style="font-family:sans-serif;color:#222;">
        <h2>${needsAction ? 'Nuova prenotazione da confermare' : 'Nuova prenotazione (confermata in automatico)'}</h2>
        ${detailHtml}
        ${actionsHtml}
      </div>`;

    return this.send({
      to: venueEmail,
      subject: needsAction
        ? `Nuova prenotazione da confermare — ${reservation.firstName} ${reservation.lastName}`
        : `Nuova prenotazione confermata — ${reservation.firstName} ${reservation.lastName}`,
      text,
      html,
    });
  }
}
