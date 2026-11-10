import {
  buildPaymentCommand,
  buildRchFiscalCommands,
  buildRchFiscalXml,
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

  it('sanitizza la descrizione a 24 caratteri senza separatori RCH', () => {
    expect(sanitizeRchDescription('Pizza (Margherita) / molto lunga oltre')).toBe(
      'Pizza Margherita molto l',
    );
  });

  it('compone vendita e pagamento protocollo RCH Standard', () => {
    expect(buildSaleCommand('Ordine n. 7', 1, 20, 1)).toBe('=R1/$2000/(Ordine n. 7)');
    expect(buildSaleCommand('Caffe', 2, 1, 2)).toBe('=R2/$100/*2/(Caffe)');
    expect(buildPaymentCommand(20, 4, 'Carta')).toBe('=T4/$2000/(Carta)');
  });

  it('costruisce lo scontrino come unica voce Ordine n. con totale e chiusura', () => {
    const commands = buildRchFiscalCommands({
      description: 'Ordine n. 12',
      total: 23.5,
      department: 1,
      paymentIndex: 4,
      paymentLabel: 'Carta',
    });
    expect(commands).toEqual(['=R1/$2350/(Ordine n. 12)', '=T4/$2350/(Carta)']);
    expect(buildRchFiscalXml(commands)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Service>',
        '  <cmd>=R1/$2350/(Ordine n. 12)</cmd>',
        '  <cmd>=T4/$2350/(Carta)</cmd>',
        '</Service>',
        '',
      ].join('\n'),
    );
    expect(joinRchFiscalPayload(commands)).toBe(buildRchFiscalXml(commands));
  });

  it('costruisce lo scontrino di test a 0 euro', () => {
    const commands = buildRchFiscalCommands({
      description: 'Test fiscale',
      total: 0,
      department: 1,
      paymentIndex: 1,
      paymentLabel: 'Contanti',
    });
    expect(commands).toEqual(['=R1/$0/(Test fiscale)', '=T1/$0/(Contanti)']);
  });
});
