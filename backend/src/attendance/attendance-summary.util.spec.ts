import { AttendanceApprovalStatus, AttendanceSource, AttendanceType } from '@prisma/client';
import { AttendanceRecordForSummary, buildAttendanceSummary, methodLabel } from './attendance-summary.util';

function record(overrides: Partial<AttendanceRecordForSummary>): AttendanceRecordForSummary {
  return {
    id: 'r1',
    type: AttendanceType.CLOCK_IN,
    timestamp: new Date('2026-09-21T08:00:00.000Z'),
    source: AttendanceSource.QR,
    approvalStatus: AttendanceApprovalStatus.CONFIRMED,
    note: null,
    employeeId: 'employee-1',
    employee: { firstName: 'Mario', lastName: 'Rossi' },
    qrToken: null,
    nfcTag: null,
    gpsLat: null,
    gpsLng: null,
    ...overrides,
  };
}

describe('buildAttendanceSummary', () => {
  it('calcola la durata di un turno abbinato in ore decimali', () => {
    const records = [
      record({ id: 'in', type: AttendanceType.CLOCK_IN, timestamp: new Date('2026-09-21T08:00:00.000Z') }),
      record({ id: 'out', type: AttendanceType.CLOCK_OUT, timestamp: new Date('2026-09-21T15:30:00.000Z') }),
    ];
    const [summary] = buildAttendanceSummary(records);
    expect(summary.days).toHaveLength(1);
    expect(summary.days[0].shifts).toHaveLength(1);
    expect(summary.days[0].shifts[0].hours).toBe(7.5);
    expect(summary.days[0].dailyTotalHours).toBe(7.5);
    expect(summary.grandTotalHours).toBe(7.5);
  });

  it('somma più turni nello stesso giorno nel totale giornaliero e finale', () => {
    const records = [
      record({ id: 'in1', type: AttendanceType.CLOCK_IN, timestamp: new Date('2026-09-21T08:00:00.000Z') }),
      record({ id: 'out1', type: AttendanceType.CLOCK_OUT, timestamp: new Date('2026-09-21T12:00:00.000Z') }),
      record({ id: 'in2', type: AttendanceType.CLOCK_IN, timestamp: new Date('2026-09-21T13:00:00.000Z') }),
      record({ id: 'out2', type: AttendanceType.CLOCK_OUT, timestamp: new Date('2026-09-21T16:00:00.000Z') }),
    ];
    const [summary] = buildAttendanceSummary(records);
    expect(summary.days[0].shifts).toHaveLength(2);
    expect(summary.days[0].dailyTotalHours).toBe(7); // 4h + 3h
    expect(summary.grandTotalHours).toBe(7);
  });

  it('un inizio senza fine resta un turno aperto, con ore null e non conteggiate', () => {
    const records = [
      record({ id: 'in', type: AttendanceType.CLOCK_IN, timestamp: new Date('2026-09-21T08:00:00.000Z') }),
    ];
    const [summary] = buildAttendanceSummary(records);
    expect(summary.days[0].shifts[0].hours).toBeNull();
    expect(summary.days[0].shifts[0].clockOut).toBeNull();
    expect(summary.days[0].dailyTotalHours).toBe(0);
    expect(summary.grandTotalHours).toBe(0);
  });

  it('una fine senza inizio non spezza il report, resta senza ore', () => {
    const records = [
      record({ id: 'out', type: AttendanceType.CLOCK_OUT, timestamp: new Date('2026-09-21T15:00:00.000Z') }),
    ];
    const [summary] = buildAttendanceSummary(records);
    expect(summary.days[0].shifts[0].hours).toBeNull();
    expect(summary.days[0].shifts[0].clockIn).toBeNull();
  });

  it('esclude dal calcolo le timbrature non confermate (PENDING/REJECTED)', () => {
    const records = [
      record({
        id: 'pending-in',
        type: AttendanceType.CLOCK_IN,
        approvalStatus: AttendanceApprovalStatus.PENDING,
        source: AttendanceSource.SELF_REPORTED,
      }),
      record({
        id: 'rejected-out',
        type: AttendanceType.CLOCK_OUT,
        approvalStatus: AttendanceApprovalStatus.REJECTED,
      }),
    ];
    const summaries = buildAttendanceSummary(records);
    expect(summaries).toHaveLength(0);
  });

  it('raggruppa e ordina per dipendente', () => {
    const records = [
      record({
        id: 'a-in',
        employeeId: 'e2',
        employee: { firstName: 'Zeno', lastName: 'Verdi' },
        timestamp: new Date('2026-09-21T08:00:00.000Z'),
      }),
      record({
        id: 'a-out',
        employeeId: 'e2',
        employee: { firstName: 'Zeno', lastName: 'Verdi' },
        type: AttendanceType.CLOCK_OUT,
        timestamp: new Date('2026-09-21T12:00:00.000Z'),
      }),
      record({
        id: 'b-in',
        employeeId: 'e1',
        employee: { firstName: 'Anna', lastName: 'Bianchi' },
        timestamp: new Date('2026-09-21T09:00:00.000Z'),
      }),
      record({
        id: 'b-out',
        employeeId: 'e1',
        employee: { firstName: 'Anna', lastName: 'Bianchi' },
        type: AttendanceType.CLOCK_OUT,
        timestamp: new Date('2026-09-21T13:00:00.000Z'),
      }),
    ];
    const summaries = buildAttendanceSummary(records);
    expect(summaries.map((s) => s.employeeName)).toEqual(['Anna Bianchi', 'Zeno Verdi']);
  });
});

describe('methodLabel', () => {
  it('mostra il riferimento del tag/token quando presente', () => {
    expect(
      methodLabel(record({ source: AttendanceSource.QR, qrToken: { label: 'Ingresso cucina' } })),
    ).toBe('QR — Ingresso cucina');
    expect(
      methodLabel(record({ source: AttendanceSource.NFC, nfcTag: { label: 'Tag banco' } })),
    ).toBe('NFC — Tag banco');
    expect(
      methodLabel(record({ source: AttendanceSource.GPS, gpsLat: 45.12345, gpsLng: 9.6789 })),
    ).toBe('GPS (45.12345, 9.67890)');
  });

  it('mostra etichette leggibili per i metodi senza riferimento', () => {
    expect(methodLabel(record({ source: AttendanceSource.MANUAL }))).toBe('App (diretta)');
    expect(methodLabel(record({ source: AttendanceSource.CORRECTION }))).toContain('admin');
    expect(methodLabel(record({ source: AttendanceSource.SELF_REPORTED }))).toContain('Dipendente');
  });
});
