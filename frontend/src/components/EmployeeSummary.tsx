import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  Stack,
  Button,
  Divider,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import NfcIcon from '@mui/icons-material/Nfc';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { QrScanDialog } from './QrScanDialog';

interface AttendanceStatus {
  lastRecord: { type: 'CLOCK_IN' | 'CLOCK_OUT'; timestamp: string } | null;
  nextAction: 'CLOCK_IN' | 'CLOCK_OUT';
}

interface ClockInSettings {
  clockInQrEnabled: boolean;
  clockInGpsEnabled: boolean;
  clockInNfcEnabled: boolean;
  gpsRadiusMeters: number;
}

interface LeaveRequestRow {
  id: string;
  type: 'VACATION' | 'PERMIT' | 'SICKNESS';
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

const leaveTypeLabels: Record<string, string> = {
  VACATION: 'Ferie',
  PERMIT: 'Permesso',
  SICKNESS: 'Malattia',
};

const statusLabels: Record<string, string> = {
  PENDING: 'In attesa',
  APPROVED: 'Approvata',
  REJECTED: 'Rifiutata',
};

const statusColor: Record<string, 'default' | 'success' | 'error'> = {
  PENDING: 'default',
  APPROVED: 'success',
  REJECTED: 'error',
};

function nowAsDatetimeLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore nella registrazione, riprova.';
}

/**
 * Riepilogo mostrato in home per Dipendenti/Responsabili: stato attuale
 * della propria timbratura con un pulsante per ciascun metodo verificato
 * abilitato dall'admin per il locale (GPS, NFC, QR — quest'ultimo apre la
 * fotocamera in un modale, senza uscire dall'app), e un recap delle proprie
 * richieste di assenza — speculare ad AdminSummary.
 */
export function EmployeeSummary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [methodError, setMethodError] = useState<string | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [nfcScanning, setNfcScanning] = useState(false);
  const [qrScanOpen, setQrScanOpen] = useState(false);
  const [selfReportOpen, setSelfReportOpen] = useState(false);
  const [selfReportTimestamp, setSelfReportTimestamp] = useState('');
  const [selfReportError, setSelfReportError] = useState<string | null>(null);
  const [selfReportSuccess, setSelfReportSuccess] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['attendance-status'],
    queryFn: async () => (await api.get<AttendanceStatus>('/attendance/me/status')).data,
  });

  const settingsQuery = useQuery({
    queryKey: ['attendance-clock-in-settings'],
    queryFn: async () => (await api.get<ClockInSettings>('/attendance/clock-in-settings')).data,
  });

  const leaveQuery = useQuery({
    queryKey: ['leave-requests-mine'],
    queryFn: async () => (await api.get<LeaveRequestRow[]>('/leave-requests/mine')).data,
  });

  const clockMutation = useMutation({
    mutationFn: async (
      payload: { gpsLat?: number; gpsLng?: number; nfcValue?: string; qrToken?: string } = {},
    ) => (await api.post('/attendance/clock', payload)).data,
    onSuccess: () => {
      setMethodError(null);
      queryClient.invalidateQueries({ queryKey: ['attendance-status'] });
    },
    onError: (err) => setMethodError(extractErrorMessage(err)),
  });

  const clockWithGps = () => {
    setMethodError(null);
    if (!navigator.geolocation) {
      setMethodError('Il browser non supporta la geolocalizzazione.');
      return;
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsBusy(false);
        clockMutation.mutate({
          gpsLat: position.coords.latitude,
          gpsLng: position.coords.longitude,
        });
      },
      () => {
        setGpsBusy(false);
        setMethodError('Posizione non disponibile: controlla i permessi del browser.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const clockWithNfc = async () => {
    setMethodError(null);
    const NDEFReaderCtor = (window as unknown as { NDEFReader?: new () => NdefReaderLike })
      .NDEFReader;
    if (!NDEFReaderCtor) {
      setMethodError('Questo dispositivo/browser non supporta la lettura NFC (serve Chrome su Android).');
      return;
    }
    try {
      setNfcScanning(true);
      const reader = new NDEFReaderCtor();
      await reader.scan();
      reader.onreading = (event: NdefReadingEventLike) => {
        setNfcScanning(false);
        const record =
          event.message.records.find((r) => r.recordType === 'text') ?? event.message.records[0];
        if (!record) {
          setMethodError('Tag NFC letto ma senza testo riconoscibile.');
          return;
        }
        const text = new TextDecoder(record.encoding || 'utf-8').decode(record.data);
        clockMutation.mutate({ nfcValue: text });
      };
      reader.onreadingerror = () => {
        setNfcScanning(false);
        setMethodError('Errore nella lettura del tag NFC, riprova.');
      };
    } catch {
      setNfcScanning(false);
      setMethodError('Impossibile avviare la lettura NFC (permesso negato o non disponibile).');
    }
  };

  const handleQrScan = (qrToken: string) => {
    setQrScanOpen(false);
    setMethodError(null);
    clockMutation.mutate({ qrToken });
  };

  const selfReportMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/attendance/self-report', {
          timestamp: new Date(selfReportTimestamp).toISOString(),
        })
      ).data,
    onSuccess: () => {
      setSelfReportOpen(false);
      setSelfReportError(null);
      setSelfReportSuccess(true);
    },
    onError: (err) => setSelfReportError(extractErrorMessage(err)),
  });

  const openSelfReport = () => {
    setSelfReportTimestamp(nowAsDatetimeLocal());
    setSelfReportError(null);
    setSelfReportSuccess(false);
    setSelfReportOpen(true);
  };

  if (!statusQuery.data) return null;

  const { lastRecord, nextAction } = statusQuery.data;
  const isClockedIn = nextAction === 'CLOCK_OUT';
  const recentLeaveRequests = (leaveQuery.data ?? []).slice(0, 3);
  const settings = settingsQuery.data;
  const hasVerifiedMethod =
    !!settings && (settings.clockInGpsEnabled || settings.clockInQrEnabled || settings.clockInNfcEnabled);
  const actionLabel = isClockedIn ? 'Fine turno' : 'Inizio turno';
  const actionIcon = isClockedIn ? <StopIcon /> : <PlayArrowIcon />;
  const actionColor = isClockedIn ? 'secondary' : 'primary';

  return (
    <Box sx={{ mb: 4 }}>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                La mia timbratura
              </Typography>
              {isClockedIn && lastRecord ? (
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  In turno dalle{' '}
                  {new Date(lastRecord.timestamp).toLocaleTimeString('it-IT', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Fuori turno
                  {lastRecord &&
                    ` — ultima uscita alle ${new Date(lastRecord.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
                </Typography>
              )}

              {methodError && (
                <Alert severity="error" sx={{ mb: 1 }} onClose={() => setMethodError(null)}>
                  {methodError}
                </Alert>
              )}
              {selfReportSuccess && (
                <Alert severity="success" sx={{ mb: 1 }} onClose={() => setSelfReportSuccess(false)}>
                  Segnalazione inviata: in attesa di conferma dell'amministratore.
                </Alert>
              )}

              <Stack spacing={1}>
                {settings?.clockInGpsEnabled && (
                  <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    color={actionColor}
                    startIcon={gpsBusy ? <CircularProgress size={18} color="inherit" /> : <GpsFixedIcon />}
                    disabled={gpsBusy || clockMutation.isPending}
                    onClick={clockWithGps}
                  >
                    {actionLabel} — GPS
                  </Button>
                )}
                {settings?.clockInNfcEnabled && (
                  <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    color={actionColor}
                    startIcon={nfcScanning ? <CircularProgress size={18} color="inherit" /> : <NfcIcon />}
                    disabled={nfcScanning || clockMutation.isPending}
                    onClick={clockWithNfc}
                  >
                    {nfcScanning ? 'Avvicina il telefono al tag…' : `${actionLabel} — NFC`}
                  </Button>
                )}
                {settings?.clockInQrEnabled && (
                  <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    color={actionColor}
                    startIcon={<QrCodeScannerIcon />}
                    disabled={clockMutation.isPending}
                    onClick={() => setQrScanOpen(true)}
                  >
                    {actionLabel} — QR
                  </Button>
                )}
                {settingsQuery.data && !hasVerifiedMethod && (
                  <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    color={actionColor}
                    startIcon={actionIcon}
                    disabled={clockMutation.isPending}
                    onClick={() => clockMutation.mutate({})}
                  >
                    {actionLabel}
                  </Button>
                )}
                <Button
                  variant="text"
                  size="small"
                  startIcon={<EditNoteIcon />}
                  onClick={openSelfReport}
                >
                  Ho dimenticato di timbrare
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Le mie richieste
              </Typography>
              {recentLeaveRequests.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nessuna richiesta recente.
                </Typography>
              ) : (
                <Stack spacing={1} divider={<Divider />}>
                  {recentLeaveRequests.map((r) => (
                    <Box
                      key={r.id}
                      sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Box>
                        <Typography variant="body2">{leaveTypeLabels[r.type]}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(r.startDate).toLocaleDateString('it-IT')} –{' '}
                          {new Date(r.endDate).toLocaleDateString('it-IT')}
                        </Typography>
                      </Box>
                      <Chip
                        size="small"
                        color={statusColor[r.status]}
                        label={statusLabels[r.status]}
                      />
                    </Box>
                  ))}
                </Stack>
              )}
              <Button
                size="small"
                sx={{ mt: 2 }}
                onClick={() => navigate('/attendance/leave-requests')}
              >
                Nuova richiesta / vedi tutte
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <QrScanDialog open={qrScanOpen} onClose={() => setQrScanOpen(false)} onScan={handleQrScan} />

      <Dialog open={selfReportOpen} onClose={() => setSelfReportOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Ho dimenticato di timbrare</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Indica quando hai fatto {isClockedIn ? 'fine' : 'inizio'} turno: la timbratura resterà
            in attesa finché l'amministratore non la conferma.
          </Typography>
          <TextField
            label="Data e ora"
            type="datetime-local"
            InputLabelProps={{ shrink: true }}
            value={selfReportTimestamp}
            onChange={(e) => setSelfReportTimestamp(e.target.value)}
          />
          {selfReportError && <Alert severity="error">{selfReportError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelfReportOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!selfReportTimestamp || selfReportMutation.isPending}
            onClick={() => selfReportMutation.mutate()}
          >
            Invia
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// Web NFC API: ancora sperimentale, non nei tipi DOM standard di TypeScript.
interface NdefRecordLike {
  recordType: string;
  encoding?: string;
  data: BufferSource;
}
interface NdefReadingEventLike {
  message: { records: NdefRecordLike[] };
}
interface NdefReaderLike {
  scan(): Promise<void>;
  onreading: ((event: NdefReadingEventLike) => void) | null;
  onreadingerror: (() => void) | null;
}
