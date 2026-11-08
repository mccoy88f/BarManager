import { canManageModule, managesAttendance } from './push-audience';

describe('destinatari delle push', () => {
  it('prenotazioni e ordini: admin sempre, gli altri solo col modulo concesso', () => {
    expect(canManageModule('ADMIN', [], 'reservations')).toBe(true);
    expect(canManageModule('ADMIN', [], 'onlineOrders')).toBe(true);
    expect(canManageModule('MANAGER', [], 'reservations')).toBe(false);
    expect(canManageModule('MANAGER', [], 'onlineOrders')).toBe(false);
    expect(canManageModule('EMPLOYEE', [], 'onlineOrders')).toBe(false);
    expect(canManageModule('MANAGER', ['reservations'], 'reservations')).toBe(true);
    expect(canManageModule('EMPLOYEE', ['onlineOrders'], 'onlineOrders')).toBe(true);
    expect(canManageModule('EMPLOYEE', ['onlineOrders'], 'reservations')).toBe(false);
  });

  it('le richieste di permesso arrivano solo a chi gestisce le timbrature', () => {
    expect(managesAttendance('ADMIN')).toBe(true);
    expect(managesAttendance('MANAGER')).toBe(true);
    expect(managesAttendance('EMPLOYEE')).toBe(false);
    expect(managesAttendance('SUPER_ADMIN')).toBe(false);
  });
});
