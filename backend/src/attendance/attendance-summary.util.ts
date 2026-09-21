import { AttendanceApprovalStatus, AttendanceSource, AttendanceType } from '@prisma/client';

/** Sottoinsieme di AttendanceRecord (con relazioni) necessario a costruire il report. */
export interface AttendanceRecordForSummary {
  id: string;
  type: AttendanceType;
  timestamp: Date;
  source: AttendanceSource;
  approvalStatus: AttendanceApprovalStatus;
  note: string | null;
  employeeId: string;
  employee: { firstName: string; lastName: string };
  qrToken?: { label: string } | null;
  nfcTag?: { label: string } | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
}

export interface ShiftRow {
  employeeName: string;
  date: string; // it-IT, es. "21/09/2026"
  dateKey: string; // ISO, per ordinamento/raggruppamento stabile
  clockIn: Date | null;
  clockOut: Date | null;
  hours: number | null; // ore decimali (centesimali), null se il turno non è abbinabile
  methodIn: string;
  methodOut: string;
  note: string;
}

export interface EmployeeDaySummary {
  date: string;
  shifts: ShiftRow[];
  dailyTotalHours: number;
}

export interface EmployeeAttendanceSummary {
  employeeName: string;
  days: EmployeeDaySummary[];
  grandTotalHours: number;
}

/** Etichetta leggibile del metodo di timbratura, col riferimento (QR/NFC/GPS) se presente. */
export function methodLabel(record: AttendanceRecordForSummary): string {
  switch (record.source) {
    case AttendanceSource.QR:
      return record.qrToken ? `QR — ${record.qrToken.label}` : 'QR';
    case AttendanceSource.NFC:
      return record.nfcTag ? `NFC — ${record.nfcTag.label}` : 'NFC';
    case AttendanceSource.GPS:
      return record.gpsLat != null && record.gpsLng != null
        ? `GPS (${record.gpsLat.toFixed(5)}, ${record.gpsLng.toFixed(5)})`
        : 'GPS';
    case AttendanceSource.MANUAL:
      return 'App (diretta)';
    case AttendanceSource.CORRECTION:
      return 'Inserita/corretta dall\'admin';
    case AttendanceSource.SELF_REPORTED:
      return 'Dipendente (confermata dall\'admin)';
    default:
      return record.source;
  }
}

function dateKeyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Abbina inizio/fine turno per calcolare la durata in ore decimali
 * (centesimali, es. 7,50 = 7h30m), raggruppata per giorno e per dipendente,
 * con totale giornaliero e totale finale. Solo le timbrature CONFIRMED
 * concorrono al calcolo: quelle in attesa di conferma (PENDING) o
 * rifiutate (REJECTED) non contano nelle ore lavorate.
 */
export function buildAttendanceSummary(
  records: AttendanceRecordForSummary[],
): EmployeeAttendanceSummary[] {
  const confirmed = records.filter((r) => r.approvalStatus === AttendanceApprovalStatus.CONFIRMED);

  const byEmployee = new Map<string, AttendanceRecordForSummary[]>();
  for (const record of confirmed) {
    const list = byEmployee.get(record.employeeId) ?? [];
    list.push(record);
    byEmployee.set(record.employeeId, list);
  }

  const summaries: EmployeeAttendanceSummary[] = [];

  for (const [, employeeRecords] of byEmployee) {
    employeeRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const employeeName = `${employeeRecords[0].employee.firstName} ${employeeRecords[0].employee.lastName}`;

    const shifts: ShiftRow[] = [];
    let open: AttendanceRecordForSummary | null = null;

    const pushUnmatched = (record: AttendanceRecordForSummary, asClockIn: boolean) => {
      shifts.push({
        employeeName,
        date: record.timestamp.toLocaleDateString('it-IT'),
        dateKey: dateKeyOf(record.timestamp),
        clockIn: asClockIn ? record.timestamp : null,
        clockOut: asClockIn ? null : record.timestamp,
        hours: null,
        methodIn: asClockIn ? methodLabel(record) : '—',
        methodOut: asClockIn ? '—' : methodLabel(record),
        note: record.note ?? '',
      });
    };

    for (const record of employeeRecords) {
      if (record.type === AttendanceType.CLOCK_IN) {
        if (open) pushUnmatched(open, true); // inizio precedente mai chiuso
        open = record;
      } else {
        if (open) {
          const hours = round2((record.timestamp.getTime() - open.timestamp.getTime()) / 3600000);
          shifts.push({
            employeeName,
            date: open.timestamp.toLocaleDateString('it-IT'),
            dateKey: dateKeyOf(open.timestamp),
            clockIn: open.timestamp,
            clockOut: record.timestamp,
            hours,
            methodIn: methodLabel(open),
            methodOut: methodLabel(record),
            note: [open.note, record.note].filter(Boolean).join(' / '),
          });
          open = null;
        } else {
          pushUnmatched(record, false); // fine turno senza inizio registrato
        }
      }
    }
    if (open) pushUnmatched(open, true); // turno ancora aperto nel periodo esportato

    const dayMap = new Map<string, ShiftRow[]>();
    for (const shift of shifts) {
      const list = dayMap.get(shift.dateKey) ?? [];
      list.push(shift);
      dayMap.set(shift.dateKey, list);
    }

    const days: EmployeeDaySummary[] = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, dayShifts]) => ({
        date: dayShifts[0].date,
        shifts: dayShifts,
        dailyTotalHours: round2(
          dayShifts.reduce((sum, s) => sum + (s.hours ?? 0), 0),
        ),
      }));

    const grandTotalHours = round2(days.reduce((sum, d) => sum + d.dailyTotalHours, 0));

    summaries.push({ employeeName, days, grandTotalHours });
  }

  summaries.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  return summaries;
}
