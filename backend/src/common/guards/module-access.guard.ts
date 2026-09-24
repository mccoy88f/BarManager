import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRE_MODULE_KEY, ModuleKey } from '../decorators/require-module.decorator';

// Permessi di default quando il dipendente non ha mai avuto un elenco
// esplicito impostato dall'admin (allowedModules vuoto): preserva il
// comportamento pre-esistente (Manager vede tutto, Dipendente solo HACCP).
// "reservations" e "customers" non compaiono qui: sono moduli opzionali
// (spenti di default per il locale), l'admin li concede esplicitamente a
// chi deve gestirli.
const DEFAULT_MODULES_BY_ROLE: Partial<Record<Role, ModuleKey[]>> = {
  [Role.MANAGER]: ['haccp', 'inventory', 'menu', 'tasks'],
  [Role.EMPLOYEE]: ['haccp'],
};

@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModule = this.reflector.getAllAndOverride<ModuleKey | undefined>(
      REQUIRE_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredModule) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // Il permesso per modulo riguarda solo Manager/Dipendente: l'Admin del
    // locale (e il Super Admin, che comunque non raggiunge questi endpoint)
    // non viene mai limitato da qui.
    if (user.role !== Role.MANAGER && user.role !== Role.EMPLOYEE) return true;

    const employee = await this.prisma.employee.findUnique({
      where: { userId: user.userId },
      select: { allowedModules: true },
    });
    // Nessun dipendente collegato: caso anomalo, non blocchiamo qui (altri
    // guard/requireVenueId si occupano di rifiutare la richiesta).
    if (!employee) return true;

    const allowed = employee.allowedModules.length
      ? employee.allowedModules
      : (DEFAULT_MODULES_BY_ROLE[user.role as Role] ?? []);

    return allowed.includes(requiredModule);
  }
}
