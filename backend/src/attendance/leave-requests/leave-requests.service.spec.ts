import { NotFoundException } from '@nestjs/common';
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
