import { SetMetadata } from '@nestjs/common';

/**
 * Chiavi dei moduli "extra" (oltre alle funzioni di base sempre disponibili
 * come la propria timbratura) concedibili per singolo dipendente
 * dall'amministratore, indipendentemente dal ruolo — vedi ModuleAccessGuard.
 * Unica fonte di verità, usata anche per validare `allowedModules` nei DTO
 * di create/update employee: un elenco duplicato lì era rimasto fermo a 4
 * chiavi quando ne sono state aggiunte altre 4 (expenses, reservations,
 * customers, onlineOrders), rifiutando con un 400 la selezione "tutti i
 * moduli" dalla UI Dipendenti.
 */
export const MODULE_KEYS = [
  'haccp',
  'inventory',
  'menu',
  'tasks',
  'expenses',
  'reservations',
  'customers',
  'onlineOrders',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const REQUIRE_MODULE_KEY = 'requireModule';
export const RequireModule = (module: ModuleKey) => SetMetadata(REQUIRE_MODULE_KEY, module);
