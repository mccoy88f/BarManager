import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

interface ShiftRow {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  hours: number | null;
  methodIn: string;
  methodOut: string;
  note: string;
}

interface DaySummary {
  date: string;
  shifts: ShiftRow[];
  dailyTotalHours: number;
}

interface HistorySummary {
  employeeName: string;
  days: DaySummary[];
  grandTotalHours: number;
}

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—';
}

/** Storico delle proprie timbrature: visibile solo se l'admin lo ha abilitato (Impostazioni > Presenze). */
export function MyAttendanceHistory() {
  const navigate = useNavigate();

  const historyQuery = useQuery({
    queryKey: ['attendance-my-history'],
    queryFn: async () => (await api.get<HistorySummary>('/attendance/me/history')).data,
    retry: false,
  });

  const disabled = (historyQuery.error as { response?: { status?: number } })?.response?.status === 403;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Button startIcon={<ArrowBackIcon />} sx={{ justifySelf: 'flex-start' }} onClick={() => navigate('/')}>
        Home
      </Button>

      <Typography variant="h5" fontWeight={700}>
        Il mio storico presenze
      </Typography>

      {disabled && (
        <Alert severity="info">
          Lo storico presenze non è abilitato per i dipendenti in questo locale. Rivolgiti
          all'amministratore.
        </Alert>
      )}

      {!disabled && historyQuery.data && (
        <>
          {historyQuery.data.days.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nessuna timbratura confermata finora.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {historyQuery.data.days.map((day) => (
                <Card key={day.date} variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle2" gutterBottom>
                      {day.date}
                    </Typography>
                    <Stack spacing={1} divider={<Divider />}>
                      {day.shifts.map((shift, i) => (
                        <Box
                          key={i}
                          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        >
                          <Box>
                            <Typography variant="body2">
                              {formatTime(shift.clockIn)} ({shift.methodIn}) →{' '}
                              {formatTime(shift.clockOut)} ({shift.methodOut})
                            </Typography>
                            {shift.note && (
                              <Typography variant="caption" color="text.secondary">
                                {shift.note}
                              </Typography>
                            )}
                          </Box>
                          <Typography variant="body2" fontWeight={600}>
                            {shift.hours != null ? `${shift.hours.toFixed(2)} h` : '—'}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      Totale giornata: {day.dailyTotalHours.toFixed(2)} h
                    </Typography>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
          <Typography variant="subtitle1" fontWeight={700}>
            Totale: {historyQuery.data.grandTotalHours.toFixed(2)} h
          </Typography>
        </>
      )}
    </Box>
  );
}
