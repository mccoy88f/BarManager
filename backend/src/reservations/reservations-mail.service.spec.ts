import { ReservationsMailService } from './reservations-mail.service';
import { MailService } from '../common/mail/mail.service';

/**
 * Bug risolto: la versione testo delle email (prenotazioni, ordini online)
 * metteva il footer (dati del locale/link privacy, buildMailFooter) PRIMA
 * della firma di chiusura ("Ti aspettiamo, {locale}"), lasciando quella
 * firma orfana dopo il footer invece di seguire naturalmente il corpo del
 * messaggio. Qui si verifica che la firma di chiusura preceda sempre il
 * footer nel testo, non il contrario.
 */
describe('ReservationsMailService — ordine footer/firma nella versione testo', () => {
  let mail: { send: jest.Mock };
  let service: ReservationsMailService;

  const venue = { name: 'Bar Test', email: 'bar@test.it' };

  const reservation = {
    firstName: 'Mario',
    lastName: 'Rossi',
    email: 'mario@test.it',
    partySize: 4,
    reservedAt: new Date('2026-01-15T19:30:00Z'),
  } as never;

  beforeEach(() => {
    mail = { send: jest.fn() };
    service = new ReservationsMailService(mail as unknown as MailService);
  });

  it('sendConfirmed: la firma "Ti aspettiamo" precede il footer', () => {
    service.sendConfirmed(reservation, venue, undefined, null, null);
    const call = mail.send.mock.calls[0][0];

    const signoffIndex = call.text.indexOf('Ti aspettiamo,');
    const footerIndex = call.text.indexOf('---');
    expect(signoffIndex).toBeGreaterThan(-1);
    expect(footerIndex).toBeGreaterThan(signoffIndex);
  });

  it('sendReceived: la firma "Grazie" precede il footer', () => {
    service.sendReceived(reservation, venue, undefined, null, null);
    const call = mail.send.mock.calls[0][0];

    const signoffIndex = call.text.indexOf('Grazie,');
    const footerIndex = call.text.indexOf('---');
    expect(signoffIndex).toBeGreaterThan(-1);
    expect(footerIndex).toBeGreaterThan(signoffIndex);
  });
});
