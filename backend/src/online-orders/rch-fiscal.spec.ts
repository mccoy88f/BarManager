import {
  buildPaymentCommand,
  buildRchFiscalCommands,
  buildSaleCommand,
  joinRchFiscalPayload,
  sanitizeRchDescription,
  toCentesimi,
} from './rch-fiscal';

describe('rch-fiscal', () => {
  it('converte euro in centesimi', () => {
    expect(toCentesimi(1.5)).toBe(150);
    expect(toCentesimi(2.005)).toBe(201);
  });

  it('sanitizza la descrizione a 24 caratteri senza virgolette', () => {
    expect(sanitizeRchDescription('Pizza "Margherita" molto lunga oltre il limite')).toBe(
      'Pizza Margherita molto l',
    );
  });

  it('compone vendita e pagamento XON/XOFF', () => {
    expect(buildSaleCommand('Pizza', 1, 8.5, 1)).toBe('"Pizza"850H1R');
    expect(buildSaleCommand('Pizza', 2, 8.5, 1)).toBe('"Pizza"2*850H1R');
    expect(buildPaymentCommand(20, 1)).toBe('2000H1T');
  });

  it('costruisce lo scontrino con spese di consegna e chiusura carta', () => {
    const commands = buildRchFiscalCommands({
      lines: [{ description: 'Pizza', quantity: 2, unitPrice: 8.5 }],
      deliveryFee: 3,
      total: 20,
      department: 1,
      deliveryDepartment: 2,
      paymentIndex: 4,
      paymentLabel: 'Carta',
    });
    expect(commands).toEqual(['"Pizza"2*850H1R', '"Spese di consegna"300H2R', '2000H4T']);
    expect(joinRchFiscalPayload(commands)).toBe('"Pizza"2*850H1R\n"Spese di consegna"300H2R\n2000H4T\n');
  });
});
