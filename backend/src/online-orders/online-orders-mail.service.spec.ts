import { OnlineOrdersMailService } from './online-orders-mail.service';
import { MailService } from '../common/mail/mail.service';

/**
 * Bug riportato dall'utente: l'email al cliente appena dopo l'ordine
 * ("ordine ricevuto"/"in attesa di apertura"/"confermato") non
 * riepilogava articoli/totale/indirizzo — solo la notifica al locale lo
 * faceva (orderLines/orderHtml). Qui si verifica che il riepilogo completo
 * arrivi anche al cliente.
 */
describe('OnlineOrdersMailService — riepilogo ordine nelle email al cliente', () => {
  let mail: { send: jest.Mock };
  let service: OnlineOrdersMailService;

  const order = {
    firstName: 'Mario',
    lastName: 'Rossi',
    email: 'mario@example.com',
    phone: '333123456',
    fulfillment: 'DELIVERY' as const,
    deliveryAddress: 'Via Roma 1, Milano',
    requestedAt: new Date('2026-01-15T19:30:00Z'),
    total: 23.5,
    lines: [
      {
        itemName: 'Margherita',
        variantName: 'Grande',
        quantity: 2,
        note: '',
        modifiers: [{ optionName: 'Formaggio extra' }],
      },
    ],
  } as never;

  beforeEach(() => {
    mail = { send: jest.fn() };
    service = new OnlineOrdersMailService(mail as unknown as MailService);
  });

  it('sendReceived include articoli, indirizzo e totale, non solo il messaggio generico', () => {
    service.sendReceived(order, 'Bar Test', 'https://example.com/traccia');
    const call = mail.send.mock.calls[0][0];

    expect(call.text).toContain('Margherita');
    expect(call.text).toContain('Via Roma 1, Milano');
    expect(call.text).toContain('23.50');
    expect(call.html).toContain('Margherita');
    expect(call.html).toContain('Via Roma 1, Milano');
    expect(call.html).toContain('23.50');
  });

  it('sendReceivedAwaitingOpening include lo stesso riepilogo', () => {
    service.sendReceivedAwaitingOpening(order, 'Bar Test', 'https://example.com/traccia');
    const call = mail.send.mock.calls[0][0];

    expect(call.text).toContain('Margherita');
    expect(call.text).toContain('23.50');
    expect(call.html).toContain('Margherita');
    expect(call.html).toContain('23.50');
  });

  it('sendConfirmed include lo stesso riepilogo', () => {
    service.sendConfirmed(order, 'Bar Test', 'https://example.com/traccia');
    const call = mail.send.mock.calls[0][0];

    expect(call.text).toContain('Margherita');
    expect(call.text).toContain('23.50');
    expect(call.html).toContain('Margherita');
    expect(call.html).toContain('23.50');
  });
});
