import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CommunicationRecipientStatus, CommunicationStatus, CommunicationType, Customer, Venue } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { MailService } from '../common/mail/mail.service';
import { CustomersService } from '../customers/customers.service';
import { stripHtml } from '../common/mail/strip-html';
import { escapeHtml } from '../common/mail/escape-html';
import { venuePublicUrl, venueLogoAbsoluteUrl } from '../common/venue-url/venue-url';
import { CreateCommunicationDto } from './dto/create-communication.dto';

/** Placeholder disponibili nell'editor, mappati sui campi di Customer (v. §1-septdecies di DEVELOPMENT.md). */
const PLACEHOLDERS: Record<string, (customer: Customer) => string> = {
  '{nome}': (c) => c.firstName,
  '{cognome}': (c) => c.lastName,
  '{email}': (c) => c.email,
};

/**
 * Marcatore testuale che l'admin inserisce nel punto esatto del testo
 * dove vuole il pulsante CTA (chip "Inserisci pulsante qui" nell'editor,
 * stesso principio dei placeholder {nome}/{cognome}/{email} sopra, ma
 * sostituito con HTML invece che con un dato del cliente). Se assente dal
 * corpo (CTA attivata ma l'admin non l'ha inserito, o rimossa per
 * errore), il pulsante va comunque in fondo come prima — non silenziarlo.
 */
const CTA_PLACEHOLDER = '{cta}';

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);
  // Vero mentre un invio è in corso: evita che il tick del cron e il "via
  // subito" lanciato da create() finiscano per inviare due email in
  // parallelo, che è esattamente quello che la coda deve impedire.
  private processing = false;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private mail: MailService,
    private customers: CustomersService,
  ) {}

  /**
   * Clienti selezionabili per il tipo scelto: per "MARKETING" solo chi ha
   * dato il consenso (marketingConsent), filtrato qui a monte e non solo
   * all'invio, così l'admin non vede nemmeno in lista chi non è
   * selezionabile per quel tipo (v. §1-septdecies).
   */
  listTargetableCustomers(venueId: string, type: CommunicationType) {
    return this.prisma.customer.findMany({
      where: {
        venueId,
        ...(type === CommunicationType.MARKETING ? { marketingConsent: true } : {}),
      },
      select: { id: true, firstName: true, lastName: true, email: true, marketingConsent: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  /**
   * Risolve i clienti destinatari lato server, sia per "tutti" sia per una
   * selezione manuale: in entrambi i casi si riparte dal filtro di
   * `listTargetableCustomers`, così un `customerIds` manomesso non può far
   * scegliere per "MARKETING" un cliente senza consenso (mai fidarsi solo
   * del filtro già applicato lato client alla lista mostrata).
   */
  private async resolveRecipients(venueId: string, dto: CreateCommunicationDto): Promise<Customer[]> {
    const targetable = await this.prisma.customer.findMany({
      where: {
        venueId,
        ...(dto.type === CommunicationType.MARKETING ? { marketingConsent: true } : {}),
      },
    });
    if (dto.allCustomers) return targetable;

    const requested = new Set(dto.customerIds);
    const recipients = targetable.filter((c) => requested.has(c.id));
    if (recipients.length === 0) {
      throw new BadRequestException(
        'Nessun destinatario valido: verifica che i clienti scelti siano ancora ammessi per questo tipo di email.',
      );
    }
    return recipients;
  }

  substitutePlaceholders(template: string, customer: Customer): string {
    let result = template;
    for (const [placeholder, resolve] of Object.entries(PLACEHOLDERS)) {
      result = result.split(placeholder).join(resolve(customer));
    }
    return result;
  }

  /** Pulsante CTA tracciato (v. PublicCommunicationsController): il link vero non va mai nell'email, solo il redirect di tracciamento. */
  private buildCtaBlock(venue: Venue, recipientId: string, label: string): { html: string; text: string } {
    const clickUrl = venuePublicUrl(venue, `/api/public/communications/${recipientId}/click`);
    return {
      html: `<div style="text-align:center;margin:20px 0;"><a href="${clickUrl}" style="display:inline-block;background:#1565c0;color:#fff;padding:10px 22px;border-radius:4px;text-decoration:none;font-weight:bold;">${escapeHtml(label)}</a></div>`,
      text: `\n\n${label}: ${clickUrl}\n`,
    };
  }

  /**
   * Dati del locale (stessi campi già usati in fondo al menù pubblico e
   * al widget prenotazioni: indirizzo, città, telefono, social, sito) più
   * il link "gestisci i tuoi dati personali" (stesso principio delle
   * email di prenotazioni/ordini online, §5.8) — in fondo a ogni email di
   * Marketing/Comunicazioni, non solo nelle altre email transazionali.
   */
  private buildFooter(venue: Venue, privacyToken: string | null): { html: string; text: string } {
    const contactLines = [venue.menuAddress, venue.city, venue.menuPhone].filter(
      (v): v is string => !!v?.trim(),
    );
    const links = [
      venue.menuWebsiteUrl ? { label: 'Sito web', url: venue.menuWebsiteUrl } : null,
      venue.menuInstagramUrl ? { label: 'Instagram', url: venue.menuInstagramUrl } : null,
      venue.menuFacebookUrl ? { label: 'Facebook', url: venue.menuFacebookUrl } : null,
    ].filter((l): l is { label: string; url: string } => !!l);
    const privacyUrl = privacyToken ? venuePublicUrl(venue, `/privacy?token=${privacyToken}`) : null;

    const text = [
      '',
      '---',
      venue.name,
      ...contactLines,
      ...links.map((l) => `${l.label}: ${l.url}`),
      ...(privacyUrl ? [`Gestisci i tuoi dati personali: ${privacyUrl}`] : []),
    ].join('\n');

    const html = [
      `<div style="margin-top:28px;padding-top:14px;border-top:1px solid #ddd;font-size:0.85em;color:#666;">`,
      `<p style="margin:0 0 4px;font-weight:bold;">${escapeHtml(venue.name)}</p>`,
      contactLines.length ? `<p style="margin:0 0 4px;">${escapeHtml(contactLines.join(' — '))}</p>` : '',
      links.length
        ? `<p style="margin:0 0 4px;">${links.map((l) => `<a href="${l.url}" style="color:#666;">${escapeHtml(l.label)}</a>`).join(' · ')}</p>`
        : '',
      privacyUrl
        ? `<p style="margin:8px 0 0;"><a href="${privacyUrl}" style="color:#999;">Gestisci i tuoi dati personali</a></p>`
        : '',
      `</div>`,
    ]
      .filter(Boolean)
      .join('');

    return { text, html };
  }

  async create(venueId: string, userId: string, dto: CreateCommunicationDto) {
    const recipients = await this.resolveRecipients(venueId, dto);

    const communication = await this.prisma.communication.create({
      data: {
        venueId,
        createdById: userId,
        type: dto.type,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        ctaLabel: dto.ctaLabel || null,
        ctaUrl: dto.ctaUrl || null,
        recipients: {
          createMany: { data: recipients.map((c) => ({ customerId: c.id })) },
        },
      },
      include: { _count: { select: { recipients: true } } },
    });

    await this.audit.log({
      venueId,
      userId,
      entity: 'Communication',
      entityId: communication.id,
      action: 'CREATE',
      after: { type: communication.type, subject: communication.subject, recipients: recipients.length },
    });

    // Avvia subito il primo invio, senza aspettare il prossimo tick del
    // cron (fino a 10s dopo, v. `tick`): resta comunque un invio alla
    // volta, protetto dallo stesso flag `processing` usato dal cron.
    void this.processNext();

    return communication;
  }

  async listHistory(venueId: string) {
    const communications = await this.prisma.communication.findMany({
      where: { venueId },
      include: {
        _count: { select: { recipients: true } },
        recipients: { select: { status: true, openedAt: true, clickedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return communications.map(({ recipients, ...c }) => ({
      ...c,
      recipientsCount: c._count.recipients,
      sentCount: recipients.filter((r) => r.status === CommunicationRecipientStatus.SENT).length,
      failedCount: recipients.filter((r) => r.status === CommunicationRecipientStatus.FAILED).length,
      queuedCount: recipients.filter((r) => r.status === CommunicationRecipientStatus.QUEUED).length,
      openedCount: recipients.filter((r) => r.openedAt).length,
      clickedCount: recipients.filter((r) => r.clickedAt).length,
    }));
  }

  async getDetail(venueId: string, id: string) {
    const communication = await this.prisma.communication.findUnique({
      where: { id },
      include: {
        recipients: {
          include: { customer: { select: { firstName: true, lastName: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!communication || communication.venueId !== venueId) {
      throw new NotFoundException('Comunicazione non trovata');
    }
    return communication;
  }

  /** Un tick ogni 10 secondi: invia al più un destinatario, per garantire l'invio sequenziale richiesto ("per non intasare il server posta"). */
  @Cron('*/10 * * * * *')
  async tick() {
    await this.processNext();
  }

  async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const recipient = await this.prisma.communicationRecipient.findFirst({
        where: { status: CommunicationRecipientStatus.QUEUED },
        orderBy: { createdAt: 'asc' },
        include: { customer: true, communication: { include: { venue: true } } },
      });
      if (!recipient) return;

      const { communication, customer } = recipient;
      const subject = this.substitutePlaceholders(communication.subject, customer);
      const body = this.substitutePlaceholders(communication.bodyHtml, customer);
      const plainBody = stripHtml(body);

      const cta =
        communication.ctaUrl && communication.ctaLabel
          ? this.buildCtaBlock(communication.venue, recipient.id, communication.ctaLabel)
          : null;

      // Il marcatore {cta} è inserito dall'admin nel punto esatto del testo
      // dove vuole il pulsante (chip "Inserisci pulsante qui" nel wizard
      // Marketing): se presente lo sostituisce lì, altrimenti il pulsante
      // va comunque in fondo come prima (CTA attivata ma non posizionata).
      // In ogni caso il marcatore letterale non deve mai arrivare al
      // cliente, nemmeno quando il CTA non è configurato.
      let html = cta
        ? body.includes(CTA_PLACEHOLDER)
          ? body.replace(CTA_PLACEHOLDER, cta.html)
          : `${body}${cta.html}`
        : body.replace(CTA_PLACEHOLDER, '');
      let text = cta
        ? plainBody.includes(CTA_PLACEHOLDER)
          ? plainBody.replace(CTA_PLACEHOLDER, cta.text)
          : `${plainBody}${cta.text}`
        : plainBody.replace(CTA_PLACEHOLDER, '');

      const privacyToken = await this.customers.ensurePrivacyToken(communication.venueId, customer.email);
      const footer = this.buildFooter(communication.venue, privacyToken);
      html += footer.html;
      text += footer.text;

      const openPixelUrl = venuePublicUrl(communication.venue, `/api/public/communications/${recipient.id}/open`);
      html += `<img src="${openPixelUrl}" width="1" height="1" alt="" style="display:none;" />`;

      const result = await this.mail.send({
        to: customer.email,
        subject,
        text,
        html,
        venueName: communication.venue.name,
        replyTo: communication.venue.email,
        logoUrl: venueLogoAbsoluteUrl(communication.venue),
      });

      await this.prisma.communicationRecipient.update({
        where: { id: recipient.id },
        data: result.sent
          ? { status: CommunicationRecipientStatus.SENT, sentAt: new Date() }
          : { status: CommunicationRecipientStatus.FAILED, error: result.error },
      });

      const stillQueued = await this.prisma.communicationRecipient.count({
        where: { communicationId: recipient.communicationId, status: CommunicationRecipientStatus.QUEUED },
      });
      if (stillQueued === 0) {
        await this.prisma.communication.update({
          where: { id: recipient.communicationId },
          data: { status: CommunicationStatus.DONE },
        });
      }
    } catch (err) {
      this.logger.error(`Invio comunicazione fallito: ${(err as Error).message}`);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Pixel di tracciamento apertura (endpoint pubblico, nessun login): un
   * `recipientId` inesistente o già segnato non è un errore, per non far
   * fallire il rendering dell'immagine nel client di posta del cliente —
   * resta no-op silenzioso (v. PublicCommunicationsController).
   */
  async markOpened(recipientId: string): Promise<void> {
    await this.prisma.communicationRecipient.updateMany({
      where: { id: recipientId, openedAt: null },
      data: { openedAt: new Date() },
    });
  }

  /**
   * Click sul pulsante CTA: segna anche l'apertura se ancora nulla (un
   * client che blocca le immagini ma permette comunque il click non deve
   * restare "mai aperta"), e ritorna l'URL di destinazione per il redirect
   * del controller — null se il destinatario non esiste o la comunicazione
   * non ha un CTA configurato.
   */
  async markClicked(recipientId: string): Promise<string | null> {
    const recipient = await this.prisma.communicationRecipient.findUnique({
      where: { id: recipientId },
      include: { communication: { select: { ctaUrl: true } } },
    });
    if (!recipient || !recipient.communication.ctaUrl) return null;

    await this.prisma.communicationRecipient.update({
      where: { id: recipientId },
      data: {
        clickedAt: recipient.clickedAt ?? new Date(),
        openedAt: recipient.openedAt ?? new Date(),
      },
    });
    return recipient.communication.ctaUrl;
  }
}
