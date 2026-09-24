import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeaveRequestsService } from './leave-requests.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { MailService } from '../../common/mail/mail.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

const admin: AuthenticatedUser = {
  userId: 'admin-1',
  email: 'admin@venue1.test',
  role: 'ADMIN',
  venueId: 'venue-1',
};

const employeeUser: AuthenticatedUser = {
  userId: 'user-1',
  email: 'dipendente@venue1.test',
  role: 'EMPLOYEE',
  venueId: 'venue-1',
};

const managerUser: AuthenticatedUser = {
  userId: 'user-2',
  email: 'responsabile@venue1.test',
  role: 'EMPLOYEE',
  venueId: 'venue-1',
};

describe('LeaveRequestsService.create — scelta del dipendente da parte dell\'admin', () => {
  let prisma: {
    employee: { findUnique: jest.Mock; findMany: jest.Mock };
    leaveRequest: { create: jest.Mock; findMany: jest.Mock };
    user: { findMany: jest.Mock };
    notification: { createMany: jest.Mock };
    venue: { findUnique: jest.Mock };
  };
  let mail: { send: jest.Mock };
  let service: LeaveRequestsService;

  const dto = {
    type: 'VACATION' as const,
    startDate: '2026-10-01',
    endDate: '2026-10-05',
  };

  beforeEach(() => {
    prisma = {
      employee: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      leaveRequest: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'lr-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      notification: { createMany: jest.fn() },
      venue: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    mail = { send: jest.fn() };
    service = new LeaveRequestsService(
      prisma as unknown as PrismaService,
      { log: jest.fn() } as unknown as AuditService,
      mail as unknown as MailService,
    );
  });

  it("l'admin crea la richiesta per il dipendente scelto", async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 'employee-2', venueId: 'venue-1' });
    const request = await service.create(admin, { ...dto, employeeId: 'employee-2' });
    expect(request.employeeId).toBe('employee-2');
  });

  it("l'admin non può associare un dipendente di un altro locale", async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 'employee-2', venueId: 'venue-2' });
    await expect(
      service.create(admin, { ...dto, employeeId: 'employee-2' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.leaveRequest.create).not.toHaveBeenCalled();
  });

  it('un dipendente non può creare la richiesta per un altro (employeeId ignorato)', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 'own-employee-id' });
    const request = await service.create(employeeUser, { ...dto, employeeId: 'employee-2' });
    // resolveEmployeeId(userId) viene comunque usato: l'employeeId richiesto è ignorato.
    expect(prisma.employee.findUnique).toHaveBeenCalledWith({
      where: { userId: employeeUser.userId },
    });
    expect(request.employeeId).toBe('own-employee-id');
  });

  it("invia un'email all'indirizzo del locale (Impostazioni), se configurato", async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'employee-2',
      venueId: 'venue-1',
      firstName: 'Mario',
      lastName: 'Rossi',
    });
    prisma.venue.findUnique.mockResolvedValue({
      email: 'locale@venue1.test',
      name: 'Bar Test',
      slug: 'bar-test',
      logoUrl: null,
    });
    await service.create(admin, { ...dto, employeeId: 'employee-2' });
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'locale@venue1.test', venueName: 'Bar Test' }),
    );
  });

  it("non invia nessuna email se il locale non ha un'email configurata", async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'employee-2',
      venueId: 'venue-1',
      firstName: 'Mario',
      lastName: 'Rossi',
    });
    prisma.venue.findUnique.mockResolvedValue({ email: null, name: 'Bar Test', slug: 'bar-test', logoUrl: null });
    await service.create(admin, { ...dto, employeeId: 'employee-2' });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('segnala la sovrapposizione con un\'altra richiesta attiva dello stesso dipendente', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'employee-2',
      venueId: 'venue-1',
      firstName: 'Mario',
      lastName: 'Rossi',
    });
    // findOverlapping esclude già la richiesta appena creata via `id: { not: excludeId }`
    // nella query reale: qui simuliamo il risultato con la sola altra richiesta attiva.
    prisma.leaveRequest.findMany.mockResolvedValue([
      { id: 'lr-existing', employeeId: 'employee-2', status: 'PENDING' },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
    const result = await service.create(admin, { ...dto, employeeId: 'employee-2' });
    expect(result.overlapWarning).toContain('si sovrappone');
    // Anche i responsabili/admin vengono avvisati nel messaggio della notifica in-app.
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('sovrappone') }),
        ]),
      }),
    );
  });

  it('nessun avviso di sovrapposizione se non ci sono altre richieste attive nello stesso periodo', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'employee-2',
      venueId: 'venue-1',
      firstName: 'Mario',
      lastName: 'Rossi',
    });
    prisma.leaveRequest.findMany.mockResolvedValue([]);
    const result = await service.create(admin, { ...dto, employeeId: 'employee-2' });
    expect(result.overlapWarning).toBeNull();
  });
});

describe('LeaveRequestsService.review — email al dipendente su approvazione/rifiuto', () => {
  let prisma: {
    leaveRequest: { findUnique: jest.Mock; update: jest.Mock };
    notification: { create: jest.Mock };
    venue: { findUnique: jest.Mock };
  };
  let mail: { send: jest.Mock };
  let service: LeaveRequestsService;

  const pending = { id: 'lr-1', status: 'PENDING' };

  const baseEmployee = {
    id: 'employee-2',
    userId: 'user-2',
    firstName: 'Mario',
    email: null as string | null,
    user: { email: 'mario.login@venue1.test' } as { email: string } | null,
  };

  const reviewedRequest = (
    overrides: Partial<{ status: string; reviewNote: string | null; employee: Partial<typeof baseEmployee> }> = {},
  ) => ({
    id: 'lr-1',
    type: 'VACATION',
    startDate: new Date('2026-10-01'),
    endDate: new Date('2026-10-05'),
    status: 'APPROVED',
    reviewNote: null,
    ...overrides,
    employee: { ...baseEmployee, ...overrides.employee },
  });

  beforeEach(() => {
    prisma = {
      leaveRequest: {
        findUnique: jest.fn().mockResolvedValue(pending),
        update: jest.fn().mockResolvedValue(reviewedRequest()),
      },
      notification: { create: jest.fn() },
      venue: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Bar Test', slug: 'bar-test', logoUrl: null }),
      },
    };
    mail = { send: jest.fn() };
    service = new LeaveRequestsService(
      prisma as unknown as PrismaService,
      { log: jest.fn() } as unknown as AuditService,
      mail as unknown as MailService,
    );
  });

  it("invia un'email all'email di contatto del dipendente se impostata (preferita al login)", async () => {
    prisma.leaveRequest.update.mockResolvedValue(
      reviewedRequest({ employee: { email: 'mario.contatto@test.it' } }),
    );
    await service.review(admin, 'lr-1', { status: 'APPROVED' } as never);
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'mario.contatto@test.it' }));
  });

  it("usa l'email di login collegata se il dipendente non ha un'email di contatto propria", async () => {
    prisma.leaveRequest.update.mockResolvedValue(
      reviewedRequest({ status: 'REJECTED', reviewNote: 'Troppi assenti quel giorno' } as never),
    );
    await service.review(admin, 'lr-1', { status: 'REJECTED', reviewNote: 'Troppi assenti quel giorno' } as never);
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'mario.login@venue1.test', subject: expect.stringContaining('rifiutata') }),
    );
  });

  it("non invia nessuna email se il dipendente non ha né email di contatto né account collegato", async () => {
    prisma.leaveRequest.update.mockResolvedValue(
      reviewedRequest({ employee: { email: null, user: null } }),
    );
    await service.review(admin, 'lr-1', { status: 'APPROVED' } as never);
    expect(mail.send).not.toHaveBeenCalled();
  });
});

describe('LeaveRequestsService.remove — cancellazione richieste approvate (admin/responsabile)', () => {
  let prisma: {
    employee: { findUnique: jest.Mock };
    leaveRequest: { findUnique: jest.Mock; delete: jest.Mock };
    venue: { findUnique: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let mail: { send: jest.Mock };
  let service: LeaveRequestsService;

  const approvedRequest = {
    id: 'lr-1',
    status: 'APPROVED',
    employeeId: 'employee-2',
    employee: { id: 'employee-2', venueId: 'venue-1' },
  };

  beforeEach(() => {
    prisma = {
      employee: { findUnique: jest.fn() },
      leaveRequest: {
        findUnique: jest.fn().mockResolvedValue(approvedRequest),
        delete: jest.fn().mockResolvedValue(approvedRequest),
      },
      venue: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    audit = { log: jest.fn() };
    mail = { send: jest.fn() };
    service = new LeaveRequestsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      mail as unknown as MailService,
    );
  });

  it("l'admin elimina una richiesta approvata", async () => {
    const result = await service.remove(admin, 'lr-1');
    expect(result).toEqual({ success: true });
    expect(prisma.leaveRequest.delete).toHaveBeenCalledWith({ where: { id: 'lr-1' } });
    expect(audit.log).toHaveBeenCalled();
  });

  it('un dipendente responsabile (isManager) elimina una richiesta approvata', async () => {
    prisma.employee.findUnique.mockResolvedValue({ isManager: true });
    await service.remove(managerUser, 'lr-1');
    expect(prisma.leaveRequest.delete).toHaveBeenCalledWith({ where: { id: 'lr-1' } });
  });

  it('un dipendente non responsabile non può eliminare la richiesta di un altro', async () => {
    prisma.employee.findUnique.mockResolvedValue({ isManager: false });
    await expect(service.remove(employeeUser, 'lr-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.leaveRequest.delete).not.toHaveBeenCalled();
  });

  it("una richiesta di un altro dipendente non ancora approvata non può essere eliminata dall'admin", async () => {
    prisma.leaveRequest.findUnique.mockResolvedValue({ ...approvedRequest, status: 'PENDING' });
    await expect(service.remove(admin, 'lr-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.leaveRequest.delete).not.toHaveBeenCalled();
  });

  it('una richiesta di un altro locale non viene trovata', async () => {
    prisma.leaveRequest.findUnique.mockResolvedValue({
      ...approvedRequest,
      employee: { id: 'employee-2', venueId: 'venue-2' },
    });
    await expect(service.remove(admin, 'lr-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("admin/responsabile che elimina la richiesta di un altro dipendente non genera l'email di annullamento", async () => {
    prisma.venue.findUnique.mockResolvedValue({ email: 'locale@venue1.test', name: 'Bar Test', slug: 'bar-test', logoUrl: null });
    await service.remove(admin, 'lr-1');
    expect(mail.send).not.toHaveBeenCalled();
  });
});

describe("LeaveRequestsService.remove — il dipendente annulla una PROPRIA richiesta", () => {
  let prisma: {
    employee: { findUnique: jest.Mock };
    leaveRequest: { findUnique: jest.Mock; delete: jest.Mock };
    venue: { findUnique: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let mail: { send: jest.Mock };
  let service: LeaveRequestsService;

  const ownRequest = (status: 'PENDING' | 'APPROVED' | 'REJECTED') => ({
    id: 'lr-1',
    type: 'VACATION',
    status,
    startDate: new Date('2026-10-01'),
    endDate: new Date('2026-10-05'),
    employeeId: 'employee-1',
    employee: { id: 'employee-1', venueId: 'venue-1', userId: employeeUser.userId, firstName: 'Mario', lastName: 'Rossi' },
  });

  beforeEach(() => {
    prisma = {
      employee: { findUnique: jest.fn() },
      leaveRequest: {
        findUnique: jest.fn().mockResolvedValue(ownRequest('PENDING')),
        delete: jest.fn().mockImplementation(() => Promise.resolve(ownRequest('PENDING'))),
      },
      venue: {
        findUnique: jest.fn().mockResolvedValue({ email: 'locale@venue1.test', name: 'Bar Test', slug: 'bar-test', logoUrl: null }),
      },
    };
    audit = { log: jest.fn() };
    mail = { send: jest.fn() };
    service = new LeaveRequestsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      mail as unknown as MailService,
    );
  });

  it('annulla una propria richiesta ancora PENDING, senza dover essere responsabile', async () => {
    const result = await service.remove(employeeUser, 'lr-1');
    expect(result).toEqual({ success: true });
    expect(prisma.leaveRequest.delete).toHaveBeenCalledWith({ where: { id: 'lr-1' } });
    // Non deve nemmeno controllare isManager: è la propria richiesta.
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('annulla anche una propria richiesta già APPROVED (i piani possono cambiare)', async () => {
    prisma.leaveRequest.findUnique.mockResolvedValue(ownRequest('APPROVED'));
    const result = await service.remove(employeeUser, 'lr-1');
    expect(result).toEqual({ success: true });
  });

  it('non può annullare una propria richiesta già REJECTED', async () => {
    prisma.leaveRequest.findUnique.mockResolvedValue(ownRequest('REJECTED'));
    await expect(service.remove(employeeUser, 'lr-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.leaveRequest.delete).not.toHaveBeenCalled();
  });

  it("invia un'email all'indirizzo del locale quando il dipendente annulla da sé", async () => {
    await service.remove(employeeUser, 'lr-1');
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'locale@venue1.test', subject: expect.stringContaining('annullata') }),
    );
  });

  it("non invia nessuna email se il locale non ha un'email configurata", async () => {
    prisma.venue.findUnique.mockResolvedValue({ email: null, name: 'Bar Test', slug: 'bar-test', logoUrl: null });
    await service.remove(employeeUser, 'lr-1');
    expect(mail.send).not.toHaveBeenCalled();
  });
});
