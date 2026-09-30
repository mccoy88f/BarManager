const LOCALE = 'it-IT';

/** Importo in euro con due decimali, es. "€ 12.50" — stesso formato ovunque nell'app. */
export function formatCurrency(amount: number): string {
  return `€ ${amount.toFixed(2)}`;
}

/** Data breve, es. "30/09/2026". */
export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString(LOCALE);
}

/** Orario, es. "14:05". */
export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

/** Data e orario nel formato di default del browser, es. "30/9/2026, 14:05:03". */
export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString(LOCALE);
}

/** Data e orario leggibili, es. "30/09/2026 alle 14:05". */
export function formatDateAndTime(value: string | Date): string {
  return `${formatDate(value)} alle ${formatTime(value)}`;
}

/** Data lunga, es. "mercoledì 30 settembre 2026" (es. aperture speciali). */
export function formatDateLong(value: string | Date): string {
  return new Date(value).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
