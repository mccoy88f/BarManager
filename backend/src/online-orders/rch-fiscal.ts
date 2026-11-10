/**
 * Tracciato XON/XOFF per registratore RCH PRINT! F (LAN).
 * Sintassi allineata al dialetto documentato per RCH/DTR/Custom
 * (importi in centesimi; chiusura su indice pulsante programmato in cassa).
 */

export type RchPaymentLabel = 'Contanti' | 'Carta';

export interface RchFiscalLineInput {
  description: string;
  quantity: number;
  /** Prezzo unitario in euro. */
  unitPrice: number;
}

export interface RchFiscalBuildInput {
  lines: RchFiscalLineInput[];
  deliveryFee: number;
  /** Totale ordine in euro (deve coincidere con somma righe + consegna). */
  total: number;
  department: number;
  deliveryDepartment: number;
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

/** Sequenza completa di comandi (una stringa per riga, terminate da \\n in payload). */
export function buildRchFiscalCommands(input: RchFiscalBuildInput): string[] {
  const commands: string[] = [];
  for (const line of input.lines) {
    commands.push(buildSaleCommand(line.description, line.quantity, line.unitPrice, input.department));
  }
  if (input.deliveryFee > 0) {
    commands.push(buildSaleCommand('Spese di consegna', 1, input.deliveryFee, input.deliveryDepartment));
  }
  commands.push(buildPaymentCommand(input.total, input.paymentIndex));
  return commands;
}

export function joinRchFiscalPayload(commands: string[]): string {
  return commands.map((c) => (c.endsWith('\n') ? c : `${c}\n`)).join('');
}
