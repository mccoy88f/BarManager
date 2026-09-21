import { SetMetadata } from '@nestjs/common';

/**
 * Chiavi dei moduli "extra" (oltre alle funzioni di base sempre disponibili
 * come la propria timbratura) concedibili per singolo dipendente
 * dall'amministratore, indipendentemente dal ruolo — vedi ModuleAccessGuard.
 */
export type ModuleKey = 'haccp' | 'inventory' | 'menu' | 'tasks';

export const REQUIRE_MODULE_KEY = 'requireModule';
export const RequireModule = (module: ModuleKey) => SetMetadata(REQUIRE_MODULE_KEY, module);
