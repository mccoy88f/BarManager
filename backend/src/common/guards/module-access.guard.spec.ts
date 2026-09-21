import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ModuleAccessGuard } from './module-access.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRE_MODULE_KEY, ModuleKey } from '../decorators/require-module.decorator';

function makeContext(user: unknown) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as import('@nestjs/common').ExecutionContext;
}

describe('ModuleAccessGuard', () => {
  let prisma: { employee: { findUnique: jest.Mock } };
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: ModuleAccessGuard;

  beforeEach(() => {
    prisma = { employee: { findUnique: jest.fn() } };
    reflector = { getAllAndOverride: jest.fn() };
    guard = new ModuleAccessGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
  });

  function withRequiredModule(moduleKey: ModuleKey | undefined) {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === REQUIRE_MODULE_KEY ? moduleKey : undefined,
    );
  }

  it('lascia passare se l\'endpoint non richiede nessun modulo', async () => {
    withRequiredModule(undefined);
    const ctx = makeContext({ role: Role.EMPLOYEE, userId: 'u1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('l\'Admin passa sempre, senza controllare allowedModules', async () => {
    withRequiredModule('inventory');
    const ctx = makeContext({ role: Role.ADMIN, userId: 'admin1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('un Dipendente senza allowedModules configurati ha solo HACCP di default', async () => {
    withRequiredModule('inventory');
    prisma.employee.findUnique.mockResolvedValue({ allowedModules: [] });
    const ctx = makeContext({ role: Role.EMPLOYEE, userId: 'e1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(false);
  });

  it('un Dipendente con "inventory" esplicitamente concesso passa', async () => {
    withRequiredModule('inventory');
    prisma.employee.findUnique.mockResolvedValue({ allowedModules: ['inventory'] });
    const ctx = makeContext({ role: Role.EMPLOYEE, userId: 'e1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('un Manager senza allowedModules configurati ha accesso a tutti i moduli', async () => {
    withRequiredModule('tasks');
    prisma.employee.findUnique.mockResolvedValue({ allowedModules: [] });
    const ctx = makeContext({ role: Role.MANAGER, userId: 'm1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('un elenco esplicito, anche per il Manager, sostituisce il default (può restringere)', async () => {
    withRequiredModule('tasks');
    prisma.employee.findUnique.mockResolvedValue({ allowedModules: ['haccp'] });
    const ctx = makeContext({ role: Role.MANAGER, userId: 'm1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(false);
  });
});
