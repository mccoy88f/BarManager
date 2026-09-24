/**
 * Colori semantici condivisi per i Chip di stato in tutta l'app: senza
 * questo, ogni pagina (Richieste ferie, Prenotazioni, Ordini, Storico
 * comunicazioni, ...) definiva la propria mappa stato→colore in modo
 * indipendente, ed è capitato che lo stesso significato ("in attesa")
 * finisse con un colore diverso da una pagina all'altra (grigio in una,
 * arancione in un'altra). Ogni mappa locale per singolo enum (definita
 * nella pagina che la usa, con le sue chiavi specifiche) va costruita
 * referenziando queste costanti, non ripetendo la stringa del colore MUI.
 */
export const PENDING_CHIP_COLOR = 'warning';
export const SUCCESS_CHIP_COLOR = 'success';
export const ERROR_CHIP_COLOR = 'error';
export const NEUTRAL_CHIP_COLOR = 'default';
