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
    expect(buildSaleCommand('Ordine n. 7', 1, 20, 1)).toBe('"Ordine n. 7"2000H1R');
    expect(buildPaymentCommand(20, 4)).toBe('2000H4T');
  });

  it('costruisce lo scontrino come unica voce Ordine n. con totale e chiusura', () => {
    const commands = buildRchFiscalCommands({
      description: 'Ordine n. 12',
      total: 23.5,
      department: 1,
      paymentIndex: 4,
      paymentLabel: 'Carta',
    });
    expect(commands).toEqual(['"Ordine n. 12"2350H1R', '2350H4T']);
    expect(joinRchFiscalPayload(commands)).toBe('"Ordine n. 12"2350H1R\n2350H4T\n');
  });

  it('costruisce lo scontrino di test a 0 euro', () => {
    const commands = buildRchFiscalCommands({
      description: 'Test fiscale',
      total: 0,
      department: 1,
      paymentIndex: 1,
      paymentLabel: 'Contanti',
    });
    expect(commands).toEqual(['"Test fiscale"0H1R', '0H1T']);
  });
});
