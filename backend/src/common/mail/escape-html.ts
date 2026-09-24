/** Escape minimo per inserire testo (mai markup) dentro un corpo email HTML, condiviso da tutti i moduli che compongono email (prenotazioni, ordini, ...). */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
