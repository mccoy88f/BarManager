import { Injectable } from '@nestjs/common';
import { OnlineOrder, OnlineOrderLine, OnlineOrderLineModifier } from '@prisma/client';
import { MailService } from '../common/mail/mail.service';
import { escapeHtml } from '../common/mail/escape-html';

type OrderWithLines = OnlineOrder & { lines: (OnlineOrderLine & { modifiers: OnlineOrderLineModifier[] })[] };

/**
 * Email al cliente sull'esito/stato del suo ordine online, ed email al
 * locale su ogni nuovo ordine in attesa — stesso pattern di
 * `ReservationsMailService` (§5.7 di DEVELOPMENT.md), applicato qui a
 * `OnlineOrder` (§5.10): un'email per transizione rilevante (ricevuto,
 * confermato, pronto, rifiutato), sempre con link alla pagina pubblica di
 * tracciamento (`manageToken`). Costruisce solo i testi/template: l'invio
 * vero e proprio è delegato al `MailService` condiviso da tutta l'app.
 */
@Injectable()
export class OnlineOrdersMailService {
  constructor(private mail: MailService) {}

  private fulfillmentLabel(order: OrderWithLines): string {
    return order.fulfillment === 'DELIVERY' ? 'consegna a domicilio' : 'ritiro in negozio';
  }

  private when(requestedAt: Date): string {
    return `${requestedAt.toLocaleDateString('it-IT')} alle ${requestedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  }

  private privacyFooter(privacyUrl?: string | null) {
    if (!privacyUrl) return { text: '', html: '' };
    return {
      text: `\n\n---\nGestisci i tuoi dati personali (marketing, cancellazione): ${privacyUrl}`,
      html: `<p style="margin-top:24px;padding-top:12px;border-top:1px solid #ddd;font-size:0.8em;color:#999;"><a href="${privacyUrl}" style="color:#999;">Gestisci i tuoi dati personali</a></p>`,
    };
  }

  private trackingBlock(trackUrl: string) {
    return {
      text: `\n\nSegui lo stato del tuo ordine qui: ${trackUrl}`,
      html: `
        <div style="margin-top:16px;">
          <a href="${trackUrl}" style="display:inline-block;background:#1565c0;color:#fff;padding:10px 22px;border-radius:4px;text-decoration:none;font-weight:bold;">Segui il tuo ordine</a>
        </div>`,
    };
  }

  private lineText(line: OrderWithLines['lines'][number]): string {
    const modifiers = line.modifiers.map((m) => m.optionName).join(', ');
    return `${line.quantity}x ${line.itemName} (${line.variantName})${modifiers ? ` — ${modifiers}` : ''}${line.note ? ` [${line.note}]` : ''}`;
  }

  private orderLines(order: OrderWithLines): string[] {
    return [
      `${order.firstName} ${order.lastName} — ${this.fulfillmentLabel(order)}`,
      this.when(order.requestedAt),
      `Email: ${order.email} — Telefono: ${order.phone}`,
      ...(order.fulfillment === 'DELIVERY' && order.deliveryAddress ? [`Indirizzo: ${order.deliveryAddress}`] : []),
      ...order.lines.map((l) => this.lineText(l)),
      `Totale: € ${order.total.toFixed(2)}`,
    ];
  }

  private orderHtml(order: OrderWithLines): string {
    return [
      `<p><strong>${escapeHtml(order.firstName)} ${escapeHtml(order.lastName)}</strong> — ${escapeHtml(this.fulfillmentLabel(order))}</p>`,
      `<p>${escapeHtml(this.when(order.requestedAt))}</p>`,
      `<p>Email: ${escapeHtml(order.email)}<br/>Telefono: ${escapeHtml(order.phone)}</p>`,
      ...(order.fulfillment === 'DELIVERY' && order.deliveryAddress
        ? [`<p>Indirizzo: ${escapeHtml(order.deliveryAddress)}</p>`]
        : []),
      `<ul>${order.lines.map((l) => `<li>${escapeHtml(this.lineText(l))}</li>`).join('')}</ul>`,
      `<p><strong>Totale: € ${order.total.toFixed(2)}</strong></p>`,
    ].join('\n');
  }

  sendReceived(
    order: OrderWithLines,
    venueName: string,
    trackUrl: string,
    venueEmail?: string | null,
    privacyUrl?: string | null,
    logoUrl?: string | null,
  ) {
    const block = this.trackingBlock(trackUrl);
    const footer = this.privacyFooter(privacyUrl);
    return this.mail.send({
      to: order.email,
      subject: `${venueName} — ordine ricevuto`,
      text: `Ciao ${order.firstName},\n\nabbiamo ricevuto il tuo ordine (${this.fulfillmentLabel(order)}) per ${this.when(order.requestedAt)}.\nTi confermeremo a breve.${block.text}${footer.text}\n\nGrazie,\n${venueName}`,
      html: `<div style="font-family:sans-serif;color:#222;">
            <p>Ciao ${escapeHtml(order.firstName)},</p>
            <p>Abbiamo ricevuto il tuo ordine (${escapeHtml(this.fulfillmentLabel(order))}) per ${escapeHtml(this.when(order.requestedAt))}. Ti confermeremo a breve.</p>
            ${block.html}
            ${footer.html}
          </div>`,
      venueName,
      replyTo: venueEmail,
      logoUrl,
    });
  }

  /**
   * Ordine "il prima possibile" arrivato mentre il negozio è chiuso
   * (§5.10 di DEVELOPMENT.md, `OnlineOrder.awaitingShopOpening`): a
   * differenza di sendReceived, avvisa il cliente che la conferma non
   * arriverà prima della riapertura, indicata in "requestedAt" (il
   * prossimo istante utile).
   */
  sendReceivedAwaitingOpening(
    order: OrderWithLines,
    venueName: string,
    trackUrl: string,
    venueEmail?: string | null,
    privacyUrl?: string | null,
    logoUrl?: string | null,
  ) {
    const block = this.trackingBlock(trackUrl);
    const footer = this.privacyFooter(privacyUrl);
    const reopenText = this.when(order.requestedAt);
    return this.mail.send({
      to: order.email,
      subject: `${venueName} — ordine ricevuto, in attesa di apertura`,
      text: `Ciao ${order.firstName},\n\nabbiamo ricevuto il tuo ordine (${this.fulfillmentLabel(order)}), ma il locale è al momento chiuso: non potremo confermarlo prima della riapertura, prevista per ${reopenText}.${block.text}${footer.text}\n\nGrazie,\n${venueName}`,
      html: `<div style="font-family:sans-serif;color:#222;">
            <p>Ciao ${escapeHtml(order.firstName)},</p>
            <p>Abbiamo ricevuto il tuo ordine (${escapeHtml(this.fulfillmentLabel(order))}), ma il locale è al momento chiuso: non potremo confermarlo prima della riapertura, prevista per <strong>${escapeHtml(reopenText)}</strong>.</p>
            ${block.html}
            ${footer.html}
          </div>`,
      venueName,
      replyTo: venueEmail,
      logoUrl,
    });
  }

  sendConfirmed(
    order: OrderWithLines,
    venueName: string,
    trackUrl: string,
    venueEmail?: string | null,
    privacyUrl?: string | null,
    logoUrl?: string | null,
  ) {
    const block = this.trackingBlock(trackUrl);
    const footer = this.privacyFooter(privacyUrl);
    return this.mail.send({
      to: order.email,
      subject: `${venueName} — ordine confermato`,
      text: `Ciao ${order.firstName},\n\nil tuo ordine (${this.fulfillmentLabel(order)}) per ${this.when(order.requestedAt)} è confermato ed è in preparazione.${block.text}${footer.text}\n\n${venueName}`,
      html: `<div style="font-family:sans-serif;color:#222;">
            <p>Ciao ${escapeHtml(order.firstName)},</p>
            <p>Il tuo ordine (${escapeHtml(this.fulfillmentLabel(order))}) per ${escapeHtml(this.when(order.requestedAt))} è confermato ed è in preparazione.</p>
            ${block.html}
            ${footer.html}
          </div>`,
      venueName,
      replyTo: venueEmail,
      logoUrl,
    });
  }

  sendReady(
    order: OrderWithLines,
    venueName: string,
    trackUrl: string,
    venueEmail?: string | null,
    privacyUrl?: string | null,
    logoUrl?: string | null,
  ) {
    const readyText =
      order.fulfillment === 'DELIVERY' ? 'è uscito per la consegna' : 'è pronto per il ritiro';
    const block = this.trackingBlock(trackUrl);
    const footer = this.privacyFooter(privacyUrl);
    return this.mail.send({
      to: order.email,
      subject: `${venueName} — ${order.fulfillment === 'DELIVERY' ? 'ordine in consegna' : 'ordine pronto'}`,
      text: `Ciao ${order.firstName},\n\nil tuo ordine ${readyText}.${block.text}${footer.text}\n\n${venueName}`,
      html: `<div style="font-family:sans-serif;color:#222;">
            <p>Ciao ${escapeHtml(order.firstName)},</p>
            <p>Il tuo ordine ${escapeHtml(readyText)}.</p>
            ${block.html}
            ${footer.html}
          </div>`,
      venueName,
      replyTo: venueEmail,
      logoUrl,
    });
  }

  sendRejected(
    order: OrderWithLines,
    venueName: string,
    reason: string,
    venueEmail?: string | null,
    privacyUrl?: string | null,
    logoUrl?: string | null,
  ) {
    const footer = this.privacyFooter(privacyUrl);
    return this.mail.send({
      to: order.email,
      subject: `${venueName} — ordine non confermato`,
      text: `Ciao ${order.firstName},\n\nnon possiamo confermare il tuo ordine per ${this.when(order.requestedAt)}.\nMotivo: ${reason}${footer.text}\n\n${venueName}`,
      html: `<div style="font-family:sans-serif;color:#222;">
            <p>Ciao ${escapeHtml(order.firstName)},</p>
            <p>Non possiamo confermare il tuo ordine per ${escapeHtml(this.when(order.requestedAt))}.</p>
            <p>Motivo: ${escapeHtml(reason)}</p>
            ${footer.html}
          </div>`,
      venueName,
      replyTo: venueEmail,
      logoUrl,
    });
  }

  /** Il locale propone un nuovo orario (tipicamente per spostare l'ordine da una fascia satura, §5.10): il cliente lo confermerà dalla stessa pagina di tracciamento. */
  sendTimeChangeRequest(
    order: OrderWithLines & { proposedRequestedAt: Date | null },
    venueName: string,
    trackUrl: string,
    venueEmail?: string | null,
    privacyUrl?: string | null,
    logoUrl?: string | null,
  ) {
    const newWhen = order.proposedRequestedAt ? this.when(order.proposedRequestedAt) : '';
    const block = this.trackingBlock(trackUrl);
    const footer = this.privacyFooter(privacyUrl);
    return this.mail.send({
      to: order.email,
      subject: `${venueName} — nuovo orario da confermare`,
      text: `Ciao ${order.firstName},\n\n${venueName} propone di spostare il tuo ordine al nuovo orario: ${newWhen}.\n\nConfermalo dalla pagina di tracciamento: ${trackUrl}\n\nSe non ti va bene, contattaci direttamente.${footer.text}\n\n${venueName}`,
      html: `
        <div style="font-family:sans-serif;color:#222;">
          <h2>Nuovo orario da confermare</h2>
          <p>Ciao ${escapeHtml(order.firstName)},</p>
          <p>${escapeHtml(venueName)} propone di spostare il tuo ordine al nuovo orario: <strong>${escapeHtml(newWhen)}</strong>.</p>
          ${block.html}
          <p style="margin-top:16px;">Se non ti va bene, contattaci direttamente.</p>
          ${footer.html}
        </div>`,
      venueName,
      replyTo: venueEmail,
      logoUrl,
    });
  }

  /**
   * Ogni nuovo ordine in PENDING avvisa l'email del locale (Impostazioni
   * locale), come già per le prenotazioni (§5.7 `sendVenueNotification`) —
   * informativo se già confermato in automatico. A differenza delle
   * prenotazioni, qui non ci sono pulsanti Accetta/Rifiuta diretti
   * dall'email (§5.10 non li prevede: l'ordine si gestisce dalla coda
   * autenticata, non da un link pubblico non protetto) — solo un link
   * alla pagina di amministrazione (richiede login).
   */
  sendVenueNotification(
    order: OrderWithLines,
    venueName: string,
    venueEmail: string,
    adminQueueUrl: string,
    needsAction: boolean,
    logoUrl?: string | null,
  ) {
    const text = [
      needsAction ? 'Nuovo ordine da confermare:' : 'Nuovo ordine (confermato in automatico):',
      '',
      ...this.orderLines(order),
      '',
      `Gestisci l'ordine: ${adminQueueUrl}`,
    ].join('\n');

    const html = `
      <div style="font-family:sans-serif;color:#222;">
        <h2>${needsAction ? 'Nuovo ordine da confermare' : 'Nuovo ordine confermato in automatico'}</h2>
        ${this.orderHtml(order)}
        <p><a href="${adminQueueUrl}">Gestisci l'ordine</a></p>
      </div>`;

    return this.mail.send({
      to: venueEmail,
      subject: `${needsAction ? 'Nuovo ordine da confermare' : 'Nuovo ordine confermato'} — ${order.firstName} ${order.lastName}`,
      text,
      html,
      venueName,
      replyTo: order.email,
      logoUrl,
    });
  }
}
