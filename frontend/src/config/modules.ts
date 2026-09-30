import type { Role } from '../store/authStore';

/**
 * Moduli "extra" concedibili per singolo dipendente dall'amministratore,
 * indipendentemente dal ruolo (vedi pagina Dipendenti). Specchia
 * backend/src/common/decorators/require-module.decorator.ts — se cambi le
 * chiavi qui, cambiale anche lì.
 */
export type ModuleKey =
  | 'haccp'
  | 'inventory'
  | 'menu'
  | 'tasks'
  | 'expenses'
  | 'reservations'
  | 'customers'
  | 'onlineOrders';

export const MODULE_LABELS: Record<ModuleKey, string> = {
  haccp: 'Controlli HACCP',
  inventory: 'Ordini e inventario',
  menu: 'Menù online',
  tasks: 'Attività',
  expenses: 'Spese',
  reservations: 'Prenotazioni',
  customers: 'Clienti',
  onlineOrders: 'Ordini online',
};

// Permessi di default quando il dipendente non ha mai avuto un elenco
// esplicito impostato dall'admin: specchia ModuleAccessGuard lato backend.
// "reservations" e "customers" non compaiono qui: sono moduli opzionali
// (spenti di default per il locale), l'admin li concede esplicitamente a
// chi deve gestirli. "expenses" (dati economici) non compare MAI nel
// default Dipendente, nemmeno esplicitamente — v. ModuleAccessGuard lato
// backend, autoritativo, per il blocco reale.
const DEFAULT_MODULES_BY_ROLE: Partial<Record<Role, ModuleKey[]>> = {
  MANAGER: ['haccp', 'inventory', 'menu', 'tasks', 'expenses'],
  EMPLOYEE: ['haccp'],
};

export function canAccessModule(
  user: { role: Role; allowedModules?: string[] } | null | undefined,
  moduleKey: ModuleKey,
): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true;
  // "expenses" non è mai concesso al Dipendente, anche indipendentemente
  // da cosa contiene allowedModules (§5.5) — il backend applica lo stesso
  // blocco in modo autoritativo, questo è solo per coerenza della UI.
  if (moduleKey === 'expenses' && user.role === 'EMPLOYEE') return false;
  const allowed = user.allowedModules?.length
    ? user.allowedModules
    : (DEFAULT_MODULES_BY_ROLE[user.role] ?? []);
  return allowed.includes(moduleKey);
}
