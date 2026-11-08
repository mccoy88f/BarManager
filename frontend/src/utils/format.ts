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

/** Estrae una descrizione leggibile da qualsiasi tipo di errore (Error, Capacitor bridge object, stringa, risposta Axios). */
export function formatErrorMessage(err: unknown, fallback = 'Errore sconosciuto'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const respData = (obj.response as { data?: { message?: string | string[] } })?.data;
    if (respData?.message) {
      return Array.isArray(respData.message) ? respData.message.join('; ') : respData.message;
    }
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.errorMessage === 'string' && obj.errorMessage) return obj.errorMessage;
    if (typeof obj.error === 'string' && obj.error) return obj.error;
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') return json;
    } catch {
      // ignore
    }
  }
  return String(err) || fallback;
}
