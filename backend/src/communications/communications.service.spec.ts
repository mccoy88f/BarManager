import { BadRequestException } from '@nestjs/common';
import { CommunicationRecipientStatus, CommunicationStatus, CommunicationType } from '@prisma/client';
import { CommunicationsService } from './communications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { MailService } from '../common/mail/mail.service';

describe('CommunicationsService', () => {
  let prisma: {
    customer: { findMany: jest.Mock };
    communication: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    communicationRecipient: { findFirst: jest.Mock; update: jest.Mock; count: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let mail: { send: jest.Mock };
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
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    audit = { log: jest.fn() };
    mail = { send: jest.fn() };
    service = new CommunicationsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      mail as unknown as MailService,
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
        subject: 'Ciao {nome}',
        bodyHtml: '<p>Ciao {nome}</p>',
        venue: { name: 'Bar Test', email: 'bar@test.it', logoUrl: null },
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
        expect.objectContaining({ to: 'mario@test.it', subject: 'Ciao Mario', html: '<p>Ciao Mario</p>' }),
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
            { status: CommunicationRecipientStatus.SENT },
            { status: CommunicationRecipientStatus.SENT },
            { status: CommunicationRecipientStatus.FAILED },
          ],
        },
      ]);

      const result = await service.listHistory('venue-1');

      expect(result[0]).toMatchObject({
        recipientsCount: 3,
        sentCount: 2,
        failedCount: 1,
        queuedCount: 0,
      });
    });
  });
});
