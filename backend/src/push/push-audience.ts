/**
 * Chi riceve quale push. Le prenotazioni e gli ordini online non sono nei
 * permessi di default: li riceve l'admin e chi ha il modulo concesso.
 * Le richieste di permesso (ferie/permesso/malattia) solo chi gestisce le
 * timbrature, cioè Admin e Responsabile.
 */
const DEFAULT_MODULES_BY_ROLE: Record<string, string[]> = {
  MANAGER: ['haccp', 'inventory', 'menu', 'tasks', 'expenses'],
  EMPLOYEE: ['haccp'],
};

export function canManageModule(
  role: string,
  allowedModules: string[] | null | undefined,
  module: 'reservations' | 'onlineOrders',
): boolean {
  if (role === 'ADMIN') return true;
  if (role !== 'MANAGER' && role !== 'EMPLOYEE') return false;
  const explicit = allowedModules ?? [];
  const allowed = explicit.length > 0 ? explicit : (DEFAULT_MODULES_BY_ROLE[role] ?? []);
  return allowed.includes(module);
}

export function managesAttendance(role: string): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}
