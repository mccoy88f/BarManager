import { Injectable } from '@nestjs/common';
import { Reservation } from '@prisma/client';
import { MailService } from '../common/mail/mail.service';

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
 * al locale su ogni nuova richiesta (con pulsanti Accetta/Rifiuta). Costruisce
 * solo i testi/template: l'invio vero e proprio (transporter SMTP, regole sul
 * mittente, logging) è delegato al MailService condiviso da tutta l'app.
 */
@Injectable()
export class ReservationsMailService {
  constructor(private mail: MailService) {}

  private when(reservedAt: Date): string {
    return `${reservedAt.toLocaleDateString('it-IT')} alle ${reservedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  }

  sendReceived(reservation: Reservation, venueName: string, venueEmail?: string | null) {
    return this.mail.send({
      to: reservation.email,
      subject: `${venueName} — richiesta di prenotazione ricevuta`,
      text: `Ciao ${reservation.firstName},\n\nabbiamo ricevuto la tua richiesta di prenotazione per ${reservation.partySize} persone il ${this.when(reservation.reservedAt)}.\nTi confermeremo a breve la disponibilità.\n\nGrazie,\n${venueName}`,
      venueName,
      replyTo: venueEmail,
    });
  }

  sendConfirmed(reservation: Reservation, venueName: string, venueEmail?: string | null) {
    return this.mail.send({
      to: reservation.email,
      subject: `${venueName} — prenotazione confermata`,
      text: `Ciao ${reservation.firstName},\n\nla tua prenotazione per ${reservation.partySize} persone il ${this.when(reservation.reservedAt)} è confermata.\n\nTi aspettiamo,\n${venueName}`,
      venueName,
      replyTo: venueEmail,
    });
  }

  sendRejected(
    reservation: Reservation,
    venueName: string,
    reason: string,
    venueEmail?: string | null,
  ) {
    return this.mail.send({
      to: reservation.email,
      subject: `${venueName} — prenotazione non confermata`,
      text: `Ciao ${reservation.firstName},\n\nnon possiamo confermare la tua prenotazione per ${reservation.partySize} persone il ${this.when(reservation.reservedAt)}.\nMotivo: ${reason}\n\n${venueName}`,
      venueName,
      replyTo: venueEmail,
    });
  }

  /** Annullamento da parte del locale (es. il cliente disdice per telefono, o l'admin corregge un errore). */
  sendCancelled(reservation: Reservation, venueName: string, venueEmail?: string | null) {
    return this.mail.send({
      to: reservation.email,
      subject: `${venueName} — prenotazione annullata`,
      text: `Ciao ${reservation.firstName},\n\nla tua prenotazione per ${reservation.partySize} persone il ${this.when(reservation.reservedAt)} è stata annullata.\nSe pensi sia un errore, contattaci direttamente.\n\n${venueName}`,
      venueName,
      replyTo: venueEmail,
    });
  }

  /**
   * Il locale propone un nuovo orario per una prenotazione già presa in
   * carico (in fase di accettazione o dopo, §10 di DEVELOPMENT.md): il
   * cliente deve confermarlo dal link (stessa pagina pubblica di
   * gestione, `confirmUrl`) prima che diventi effettivo — "reservedAt"
   * non cambia da solo.
   */
  sendTimeChangeRequest(
    reservation: Reservation & { proposedReservedAt: Date | null },
    venueName: string,
    confirmUrl: string,
    venueEmail?: string | null,
  ) {
    const newWhen = reservation.proposedReservedAt ? this.when(reservation.proposedReservedAt) : '';
    return this.mail.send({
      to: reservation.email,
      subject: `${venueName} — nuovo orario da confermare`,
      text: `Ciao ${reservation.firstName},\n\n${venueName} propone di spostare la tua prenotazione per ${reservation.partySize} persone al nuovo orario: ${newWhen}.\n\nConfermalo qui: ${confirmUrl}\n\nSe non ti va bene, contattaci direttamente.\n\n${venueName}`,
      html: `
        <div style="font-family:sans-serif;color:#222;">
          <h2>Nuovo orario da confermare</h2>
          <p>Ciao ${escapeHtml(reservation.firstName)},</p>
          <p>${escapeHtml(venueName)} propone di spostare la tua prenotazione per ${reservation.partySize} persone al nuovo orario: <strong>${escapeHtml(newWhen)}</strong>.</p>
          <div style="margin-top:16px;">
            <a href="${confirmUrl}" style="display:inline-block;background:#2e7d32;color:#fff;padding:10px 22px;border-radius:4px;text-decoration:none;font-weight:bold;">Confermo il nuovo orario</a>
          </div>
          <p style="margin-top:16px;">Se non ti va bene, contattaci direttamente.</p>
        </div>`,
      venueName,
      replyTo: venueEmail,
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

    return this.mail.send({
      to: venueEmail,
      subject: needsAction
        ? `Nuova prenotazione da confermare — ${reservation.firstName} ${reservation.lastName}`
        : `Nuova prenotazione confermata — ${reservation.firstName} ${reservation.lastName}`,
      text,
      html,
      venueName,
      replyTo: reservation.email,
    });
  }
}
