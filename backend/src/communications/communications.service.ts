import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CommunicationRecipientStatus, CommunicationStatus, CommunicationType, Customer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { MailService } from '../common/mail/mail.service';
import { stripHtml } from '../common/mail/strip-html';
import { CreateCommunicationDto } from './dto/create-communication.dto';

/** Placeholder disponibili nell'editor, mappati sui campi di Customer (v. §1-septdecies di DEVELOPMENT.md). */
const PLACEHOLDERS: Record<string, (customer: Customer) => string> = {
  '{nome}': (c) => c.firstName,
  '{cognome}': (c) => c.lastName,
  '{email}': (c) => c.email,
};

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

  async create(venueId: string, userId: string, dto: CreateCommunicationDto) {
    const recipients = await this.resolveRecipients(venueId, dto);

    const communication = await this.prisma.communication.create({
      data: {
        venueId,
        createdById: userId,
        type: dto.type,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
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
        recipients: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return communications.map(({ recipients, ...c }) => ({
      ...c,
      recipientsCount: c._count.recipients,
      sentCount: recipients.filter((r) => r.status === CommunicationRecipientStatus.SENT).length,
      failedCount: recipients.filter((r) => r.status === CommunicationRecipientStatus.FAILED).length,
      queuedCount: recipients.filter((r) => r.status === CommunicationRecipientStatus.QUEUED).length,
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
      const html = this.substitutePlaceholders(communication.bodyHtml, customer);

      const result = await this.mail.send({
        to: customer.email,
        subject,
        text: stripHtml(html),
        html,
        venueName: communication.venue.name,
        replyTo: communication.venue.email,
        logoUrl: communication.venue.logoUrl,
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
}
