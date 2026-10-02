import { BadRequestException } from '@nestjs/common';
import { CommunicationRecipientStatus, CommunicationStatus, CommunicationType } from '@prisma/client';
import { CommunicationsService } from './communications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { MailService } from '../common/mail/mail.service';
import { CustomersService } from '../customers/customers.service';

describe('CommunicationsService', () => {
  let prisma: {
    customer: { findMany: jest.Mock };
    communication: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    communicationRecipient: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let audit: { log: jest.Mock };
  let mail: { send: jest.Mock };
  let customersService: { ensurePrivacyToken: jest.Mock };
  let service: CommunicationsService;

  const customers = [
    { id: 'c1', firstName: 'Mario', lastName: 'Rossi', email: 'mario@test.it', marketingConsent: true },
    { id: 'c2', firstName: 'Anna', lastName: 'Bianchi', email: 'anna@test.it', marketingConsent: false },
  ];

  beforeEach(() => {
    prisma = {
      // Simula il filtro `where.marketingConsent` che nella realtà applica
      // il database: un mock statico non lo farebbe, e nasconderebbe un
      // eventuale bug per cui il servizio si affida al filtro Prisma senza
      // controllarlo davvero.
      customer: {
        findMany: jest.fn().mockImplementation((args: { where?: { marketingConsent?: boolean } }) =>
          Promise.resolve(args?.where?.marketingConsent ? customers.filter((c) => c.marketingConsent) : customers),
        ),
      },
      communication: {
        create: jest.fn().mockResolvedValue({ id: 'comm-1', type: CommunicationType.COMMUNICATION, subject: 'Oggetto' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      communicationRecipient: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    audit = { log: jest.fn() };
    mail = { send: jest.fn() };
    // null di default: la maggior parte dei test non riguarda il footer/link privacy.
    customersService = { ensurePrivacyToken: jest.fn().mockResolvedValue(null) };
    service = new CommunicationsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      mail as unknown as MailService,
      customersService as unknown as CustomersService,
    );
  });

  describe('listTargetableCustomers', () => {
    it('per COMMUNICATION non filtra sul consenso marketing', async () => {
      await service.listTargetableCustomers('venue-1', CommunicationType.COMMUNICATION);
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { venueId: 'venue-1' } }),
      );
    });

    it('per MARKETING filtra solo chi ha marketingConsent=true', async () => {
      await service.listTargetableCustomers('venue-1', CommunicationType.MARKETING);
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { venueId: 'venue-1', marketingConsent: true } }),
      );
    });
  });

  describe('create — targeting destinatari', () => {
    it('con allCustomers=true e tipo COMMUNICATION accoda tutti i clienti del locale', async () => {
      await service.create('venue-1', 'user-1', {
        type: CommunicationType.COMMUNICATION,
        subject: 'Chiusura straordinaria',
        bodyHtml: '<p>Ciao {nome}</p>',
        allCustomers: true,
      });

      expect(prisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recipients: { createMany: { data: [{ customerId: 'c1' }, { customerId: 'c2' }] } },
          }),
        }),
      );
    });

    it('con allCustomers=true e tipo MARKETING accoda solo chi ha dato il consenso', async () => {
      await service.create('venue-1', 'user-1', {
        type: CommunicationType.MARKETING,
        subject: 'Promo',
        bodyHtml: '<p>Ciao {nome}</p>',
        allCustomers: true,
      });

      expect(prisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ recipients: { createMany: { data: [{ customerId: 'c1' }] } } }),
        }),
      );
    });

    it('con selezione manuale ignora gli id di clienti non ammessi per il tipo (es. senza consenso marketing)', async () => {
      await service.create('venue-1', 'user-1', {
        type: CommunicationType.MARKETING,
        subject: 'Promo',
        bodyHtml: '<p>Ciao {nome}</p>',
        allCustomers: false,
        customerIds: ['c1', 'c2'], // c2 non ha marketingConsent
      });

      expect(prisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ recipients: { createMany: { data: [{ customerId: 'c1' }] } } }),
        }),
      );
    });

    it('rifiuta se, dopo il filtro, non resta alcun destinatario valido', async () => {
      await expect(
        service.create('venue-1', 'user-1', {
          type: CommunicationType.MARKETING,
          subject: 'Promo',
          bodyHtml: '<p>Ciao</p>',
          allCustomers: false,
          customerIds: ['c2'], // unico id selezionato, senza consenso marketing
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.communication.create).not.toHaveBeenCalled();
    });

    it('registra un audit log di creazione', async () => {
      await service.create('venue-1', 'user-1', {
        type: CommunicationType.COMMUNICATION,
        subject: 'Chiusura',
        bodyHtml: '<p>Ciao</p>',
        allCustomers: true,
      });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ venueId: 'venue-1', userId: 'user-1', entity: 'Communication', action: 'CREATE' }),
      );
    });
  });

  describe('substitutePlaceholders', () => {
    it('sostituisce {nome}/{cognome}/{email} con i campi del cliente', () => {
      const result = service.substitutePlaceholders(
        'Ciao {nome} {cognome}, ti scriviamo a {email}.',
        customers[0] as any,
      );
      expect(result).toBe('Ciao Mario Rossi, ti scriviamo a mario@test.it.');
    });
  });

  describe('processNext — invio sequenziale', () => {
    const recipient = {
      id: 'rec-1',
      communicationId: 'comm-1',
      customer: customers[0],
      communication: {
        id: 'comm-1',
        venueId: 'venue-1',
        subject: 'Ciao {nome}',
        bodyHtml: '<p>Ciao {nome}</p>',
        venue: {
          slug: 'bar-test',
          name: 'Bar Test',
          email: 'bar@test.it',
          logoUrl: null,
          menuAddress: null,
          city: null,
          menuPhone: null,
          menuWebsiteUrl: null,
          menuInstagramUrl: null,
          menuFacebookUrl: null,
        },
      },
    };

    it('senza destinatari in coda non invia nulla', async () => {
      prisma.communicationRecipient.findFirst.mockResolvedValue(null);
      await service.processNext();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('invia il destinatario più vecchio in coda con i placeholder sostituiti e lo marca SENT', async () => {
      prisma.communicationRecipient.findFirst.mockResolvedValue(recipient);
      mail.send.mockResolvedValue({ sent: true });
      prisma.communicationRecipient.count.mockResolvedValue(0);

      await service.processNext();

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'mario@test.it',
          subject: 'Ciao Mario',
          html: expect.stringContaining('<p>Ciao Mario</p>'),
        }),
      );
      // Pixel di tracciamento apertura sempre presente, identificato dal destinatario.
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ html: expect.stringContaining('/public/communications/rec-1/open') }),
      );
      expect(prisma.communicationRecipient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-1' },
          data: expect.objectContaining({ status: CommunicationRecipientStatus.SENT }),
        }),
      );
      // Nessun altro destinatario in coda: la comunicazione passa a DONE.
      expect(prisma.communication.update).toHaveBeenCalledWith({
        where: { id: 'comm-1' },
        data: { status: CommunicationStatus.DONE },
      });
    });

    it('se il MailService fallisce marca il destinatario FAILED con l\'errore, senza fermare il resto', async () => {
      prisma.communicationRecipient.findFirst.mockResolvedValue(recipient);
      mail.send.mockResolvedValue({ sent: false, error: 'SMTP down' });
      prisma.communicationRecipient.count.mockResolvedValue(1); // restano altri destinatari in coda

      await service.processNext();

      expect(prisma.communicationRecipient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-1' },
          data: { status: CommunicationRecipientStatus.FAILED, error: 'SMTP down' },
        }),
      );
      expect(prisma.communication.update).not.toHaveBeenCalled();
    });

    it('non elabora due destinatari in parallelo (un invio alla volta)', async () => {
      prisma.communicationRecipient.findFirst.mockResolvedValue(recipient);
      mail.send.mockResolvedValue({ sent: true });

      await Promise.all([service.processNext(), service.processNext()]);

      expect(prisma.communicationRecipient.findFirst).toHaveBeenCalledTimes(1);
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    it('con un CTA configurato aggiunge il pulsante tracciato al corpo e al testo semplice', async () => {
      prisma.communicationRecipient.findFirst.mockResolvedValue({
        ...recipient,
        communication: { ...recipient.communication, ctaLabel: 'Prenota ora', ctaUrl: 'https://esterno.test/promo' },
      });
      mail.send.mockResolvedValue({ sent: true });
      prisma.communicationRecipient.count.mockResolvedValue(0);

      await service.processNext();

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('/public/communications/rec-1/click'),
          text: expect.stringContaining('/public/communications/rec-1/click'),
        }),
      );
      // Il link vero non è mai inviato direttamente, né in HTML né in testo semplice: passa sempre dal redirect di tracciamento.
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.not.stringContaining('https://esterno.test/promo'),
          text: expect.not.stringContaining('https://esterno.test/promo'),
        }),
      );
    });

    it('se il corpo contiene il marcatore {cta} posiziona lì il pulsante, non in fondo', async () => {
      prisma.communicationRecipient.findFirst.mockResolvedValue({
        ...recipient,
        communication: {
          ...recipient.communication,
          bodyHtml: '<p>Ciao {nome}</p><p>Prima parte</p>{cta}<p>Dopo il pulsante</p>',
          ctaLabel: 'Prenota ora',
          ctaUrl: 'https://esterno.test/promo',
        },
      });
      mail.send.mockResolvedValue({ sent: true });

      await service.processNext();

      const call = mail.send.mock.calls[0][0];
      expect(call.html).not.toContain('{cta}');
      expect(call.html.indexOf('/click')).toBeLessThan(call.html.indexOf('Dopo il pulsante'));
      expect(call.html.indexOf('Prima parte')).toBeLessThan(call.html.indexOf('/click'));
    });

    it('rimuove il marcatore {cta} dal testo se il CTA non è configurato', async () => {
      prisma.communicationRecipient.findFirst.mockResolvedValue({
        ...recipient,
        communication: { ...recipient.communication, bodyHtml: '<p>Ciao {nome}</p>{cta}<p>Fine</p>' },
      });
      mail.send.mockResolvedValue({ sent: true });

      await service.processNext();

      const call = mail.send.mock.calls[0][0];
      expect(call.html).not.toContain('{cta}');
      expect(call.text).not.toContain('{cta}');
    });

    it('usa l\'URL assoluto del logo, non il percorso relativo salvato', async () => {
      prisma.communicationRecipient.findFirst.mockResolvedValue({
        ...recipient,
        communication: {
          ...recipient.communication,
          venue: { ...recipient.communication.venue, logoUrl: '/uploads/logo.png' },
        },
      });
      mail.send.mockResolvedValue({ sent: true });

      await service.processNext();

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ logoUrl: expect.stringContaining('/uploads/logo.png') }),
      );
      const { logoUrl } = mail.send.mock.calls[0][0];
      expect(logoUrl).toMatch(/^https?:\/\//);
    });

    it('include nel footer i dati del locale e, se il cliente ha un token, il link gestione privacy', async () => {
      prisma.communicationRecipient.findFirst.mockResolvedValue({
        ...recipient,
        communication: {
          ...recipient.communication,
          venue: {
            ...recipient.communication.venue,
            menuAddress: 'Via Roma 1',
            city: 'Milano',
            menuPhone: '0212345',
            menuWebsiteUrl: 'https://bartest.it',
            menuInstagramUrl: 'https://instagram.com/bartest',
          },
        },
      });
      customersService.ensurePrivacyToken.mockResolvedValue('privacy-token-123');
      mail.send.mockResolvedValue({ sent: true });

      await service.processNext();

      expect(customersService.ensurePrivacyToken).toHaveBeenCalledWith('venue-1', 'mario@test.it');
      const call = mail.send.mock.calls[0][0];
      expect(call.html).toContain('Via Roma 1');
      expect(call.html).toContain('Milano');
      expect(call.html).toContain('0212345');
      expect(call.html).toContain('https://bartest.it');
      expect(call.html).toContain('https://instagram.com/bartest');
      expect(call.html).toContain('privacy-token-123');
      expect(call.text).toContain('Via Roma 1');
      expect(call.text).toContain('privacy-token-123');
    });

    it('non include il link privacy se il cliente non ha ancora un token', async () => {
      prisma.communicationRecipient.findFirst.mockResolvedValue(recipient);
      prisma.communicationRecipient.count.mockResolvedValue(0);
      customersService.ensurePrivacyToken.mockResolvedValue(null);
      mail.send.mockResolvedValue({ sent: true });

      await service.processNext();

      const call = mail.send.mock.calls[0][0];
      expect(call.html).not.toContain('Gestisci i tuoi dati personali');
    });
  });

  describe('markOpened', () => {
    it('imposta openedAt solo se ancora nullo', async () => {
      await service.markOpened('rec-1');
      expect(prisma.communicationRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: 'rec-1', openedAt: null },
        data: { openedAt: expect.any(Date) },
      });
    });
  });

  describe('markClicked', () => {
    it('restituisce null se il destinatario non esiste', async () => {
      prisma.communicationRecipient.findUnique.mockResolvedValue(null);
      await expect(service.markClicked('rec-x')).resolves.toBeNull();
      expect(prisma.communicationRecipient.update).not.toHaveBeenCalled();
    });

    it('restituisce null se la comunicazione non ha un CTA', async () => {
      prisma.communicationRecipient.findUnique.mockResolvedValue({
        id: 'rec-1',
        openedAt: null,
        clickedAt: null,
        communication: { ctaUrl: null },
      });
      await expect(service.markClicked('rec-1')).resolves.toBeNull();
    });

    it('segna click e apertura (se ancora nulla) e restituisce il ctaUrl', async () => {
      prisma.communicationRecipient.findUnique.mockResolvedValue({
        id: 'rec-1',
        openedAt: null,
        clickedAt: null,
        communication: { ctaUrl: 'https://esterno.test/promo' },
      });

      const result = await service.markClicked('rec-1');

      expect(result).toBe('https://esterno.test/promo');
      expect(prisma.communicationRecipient.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { clickedAt: expect.any(Date), openedAt: expect.any(Date) },
      });
    });

    it('non sovrascrive un\'apertura già registrata', async () => {
      const firstOpen = new Date('2026-01-01T10:00:00.000Z');
      prisma.communicationRecipient.findUnique.mockResolvedValue({
        id: 'rec-1',
        openedAt: firstOpen,
        clickedAt: null,
        communication: { ctaUrl: 'https://esterno.test/promo' },
      });

      await service.markClicked('rec-1');

      expect(prisma.communicationRecipient.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { clickedAt: expect.any(Date), openedAt: firstOpen },
      });
    });
  });

  describe('listHistory', () => {
    it('aggrega i conteggi per stato di ciascuna comunicazione', async () => {
      prisma.communication.findMany.mockResolvedValue([
        {
          id: 'comm-1',
          type: CommunicationType.COMMUNICATION,
          subject: 'Chiusura',
          _count: { recipients: 3 },
          recipients: [
            { status: CommunicationRecipientStatus.SENT, openedAt: new Date(), clickedAt: new Date() },
            { status: CommunicationRecipientStatus.SENT, openedAt: null, clickedAt: null },
            { status: CommunicationRecipientStatus.FAILED, openedAt: null, clickedAt: null },
          ],
        },
      ]);

      const result = await service.listHistory('venue-1');

      expect(result[0]).toMatchObject({
        recipientsCount: 3,
        sentCount: 2,
        failedCount: 1,
        queuedCount: 0,
        openedCount: 1,
        clickedCount: 1,
      });
    });
  });
});
