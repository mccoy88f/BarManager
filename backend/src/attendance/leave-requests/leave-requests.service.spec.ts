import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeaveRequestsService } from './leave-requests.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
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
    leaveRequest: { create: jest.Mock };
    user: { findMany: jest.Mock };
    notification: { createMany: jest.Mock };
  };
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
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      notification: { createMany: jest.fn() },
    };
    service = new LeaveRequestsService(
      prisma as unknown as PrismaService,
      { log: jest.fn() } as unknown as AuditService,
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
});

describe('LeaveRequestsService.remove — cancellazione richieste approvate', () => {
  let prisma: {
    employee: { findUnique: jest.Mock };
    leaveRequest: { findUnique: jest.Mock; delete: jest.Mock };
  };
  let audit: { log: jest.Mock };
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
    };
    audit = { log: jest.fn() };
    service = new LeaveRequestsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
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

  it('un dipendente non responsabile non può eliminare la richiesta', async () => {
    prisma.employee.findUnique.mockResolvedValue({ isManager: false });
    await expect(service.remove(employeeUser, 'lr-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.leaveRequest.delete).not.toHaveBeenCalled();
  });

  it('una richiesta non ancora approvata non può essere eliminata', async () => {
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
});
