/**
 * Tracciato XON/XOFF per registratore RCH PRINT! F (LAN).
 * Sintassi allineata al dialetto documentato per RCH/DTR/Custom
 * (importi in centesimi; chiusura su indice pulsante programmato in cassa).
 *
 * v1: una sola riga di vendita "Ordine n. X" con il totale ordine
 * (spese di consegna già incluse), poi chiusura pagamento.
 */

export type RchPaymentLabel = 'Contanti' | 'Carta';

export interface RchFiscalBuildInput {
  /** Descrizione riga vendita (es. "Ordine n. 12" o "Test fiscale"). */
  description: string;
  /** Totale in euro (subtotale + consegna; 0 per il test). */
  total: number;
  department: number;
  paymentIndex: number;
  paymentLabel: RchPaymentLabel;
}

/** Euro → centesimi interi (arrotondamento bancario via Math.round). */
export function toCentesimi(euros: number): number {
  return Math.round(Number(euros) * 100);
}

/** Descrizione riga vendita: max 24 caratteri, senza virgolette. */
export function sanitizeRchDescription(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Articolo').slice(0, 24);
}

/**
 * Comando vendita XON/XOFF: `"DESC"<qty>*?<cents>H<dept>R`
 * qty omessa se 1 (convenzione tipica RCH).
 */
export function buildSaleCommand(description: string, quantity: number, unitPriceEuros: number, department: number): string {
  const desc = sanitizeRchDescription(description);
  const cents = toCentesimi(unitPriceEuros);
  const qty = Math.max(1, Math.round(quantity));
  const qtyPrefix = qty === 1 ? '' : `${qty}*`;
  return `"${desc}"${qtyPrefix}${cents}H${department}R`;
}

/** Comando pagamento: `<cents>H<paymentIndex>T` */
export function buildPaymentCommand(totalEuros: number, paymentIndex: number): string {
  return `${toCentesimi(totalEuros)}H${paymentIndex}T`;
}

/** Una riga di vendita al totale, poi chiusura pagamento. */
export function buildRchFiscalCommands(input: RchFiscalBuildInput): string[] {
  return [
    buildSaleCommand(input.description, 1, input.total, input.department),
    buildPaymentCommand(input.total, input.paymentIndex),
  ];
}

export function joinRchFiscalPayload(commands: string[]): string {
  return commands.map((c) => (c.endsWith('\n') ? c : `${c}\n`)).join('');
}
