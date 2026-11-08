import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import SettingsApplicationsIcon from '@mui/icons-material/SettingsApplications';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  appSettings,
  isNativeApp,
  AppInfoResult,
  UpdateInfoResult,
  DownloadProgress,
} from '../printing/nativePrint';
import { APP_VERSION } from '../version';

interface AppSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AppSettingsDialog({ open, onClose }: AppSettingsDialogProps) {
  const [appInfo, setAppInfo] = useState<AppInfoResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfoResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installPrompted, setInstallPrompted] = useState(false);

  const native = isNativeApp();

  const loadInfoAndCheck = async () => {
    if (!native) return;
    setError(null);
    setChecking(true);
    setInstallPrompted(false);

    try {
      const plugin = await appSettings();
      const info = await plugin.getAppInfo();
      setAppInfo(info);

      const update = await plugin.checkForUpdate();
      setUpdateInfo(update);
    } catch (e) {
      setError((e as Error)?.message ?? 'Impossibile verificare gli aggiornamenti');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (open) {
      setProgress(null);
      setDownloading(false);
      setInstallPrompted(false);
      loadInfoAndCheck();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !native) return;
    let removeListener: (() => Promise<void>) | undefined;

    appSettings().then((plugin) => {
      plugin
        .addListener?.('updateProgress', (data: DownloadProgress) => {
          setProgress(data);
        })
        .then((handle) => {
          if (handle) {
            removeListener = handle.remove;
          }
        })
        .catch(() => {});
    });

    return () => {
      removeListener?.();
    };
  }, [open, native]);

  const handleStartDownload = async () => {
    if (!updateInfo?.downloadUrl) return;
    setDownloading(true);
    setError(null);
    setProgress({ percent: 0, downloadedMb: 0, totalMb: updateInfo.sizeBytes ? updateInfo.sizeBytes / 1048576 : 0 });

    try {
      const plugin = await appSettings();
      await plugin.downloadAndInstallUpdate({ downloadUrl: updateInfo.downloadUrl });
      setInstallPrompted(true);
    } catch (e) {
      setError((e as Error)?.message ?? 'Errore durante download o installazione');
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenDomain = async () => {
    try {
      const plugin = await appSettings();
      await plugin.openDomainSettings();
    } catch (e) {
      setError((e as Error)?.message ?? 'Impossibile aprire impostazioni dominio');
    }
  };

  return (
    <Dialog open={open} onClose={downloading ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ m: 0, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <SettingsApplicationsIcon color="primary" />
          <Typography variant="h6" component="span" fontWeight={600}>
            Impostazioni app
          </Typography>
        </Stack>
        <IconButton
          aria-label="Chiudi"
          onClick={onClose}
          disabled={downloading}
          sx={{ color: (t) => t.palette.grey[500] }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5}>
          {/* Sezione Versione e Aggiornamenti */}
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="subtitle1" fontWeight={600}>
                Aggiornamenti applicazione
              </Typography>
              {native && (
                <Button
                  size="small"
                  startIcon={checking ? <CircularProgress size={16} /> : <RefreshIcon />}
                  disabled={checking || downloading}
                  onClick={loadInfoAndCheck}
                >
                  {checking ? 'Verifica...' : 'Verifica ora'}
                </Button>
              )}
            </Stack>

            <Typography variant="body2" color="text.secondary" gutterBottom>
              Versione installata:{' '}
              <strong>{native ? appInfo?.versionName ?? 'Caricamento...' : APP_VERSION}</strong>
              {native && appInfo?.versionCode ? ` (build ${appInfo.versionCode})` : ''}
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {error}
              </Alert>
            )}

            {!native && (
              <Alert severity="info" sx={{ mt: 1 }}>
                Stai utilizzando la versione Web del gestionale ({APP_VERSION}). Gli aggiornamenti APK automatici da GitHub
                sono dedicati all'applicazione Android nativa BarManager.{' '}
                <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                  <Button
                    size="small"
                    endIcon={<OpenInNewIcon />}
                    href="https://github.com/mccoy88f/BarManager/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Vedi release su GitHub
                  </Button>
                </Box>
              </Alert>
            )}

            {native && !error && !checking && updateInfo && (
              <>
                {!updateInfo.hasUpdate ? (
                  <Alert icon={<CheckCircleOutlineIcon fontSize="inherit" />} severity="success" sx={{ mt: 1 }}>
                    L'app è aggiornata all'ultima versione disponibile ({updateInfo.latestVersion}).
                  </Alert>
                ) : (
                  <Box
                    sx={{
                      mt: 1.5,
                      p: 2,
                      border: 1,
                      borderColor: 'primary.light',
                      borderRadius: 1.5,
                      bgcolor: 'action.hover',
                    }}
                  >
                    <Typography variant="subtitle2" color="primary" fontWeight={600} gutterBottom>
                      Nuova versione disponibile: v{updateInfo.latestVersion}
                    </Typography>
                    {updateInfo.sizeBytes ? (
                      <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                        Dimensione download: {(updateInfo.sizeBytes / 1048576).toFixed(1)} MB
                      </Typography>
                    ) : null}

                    {updateInfo.releaseNotes && (
                      <Typography
                        variant="body2"
                        sx={{
                          whiteSpace: 'pre-wrap',
                          maxHeight: 120,
                          overflowY: 'auto',
                          bgcolor: 'background.paper',
                          p: 1,
                          borderRadius: 1,
                          my: 1,
                          fontSize: '0.8rem',
                          fontFamily: 'monospace',
                        }}
                      >
                        {updateInfo.releaseNotes}
                      </Typography>
                    )}

                    {downloading ? (
                      <Box sx={{ mt: 2 }}>
                        <LinearProgress
                          variant={progress && progress.totalMb > 0 ? 'determinate' : 'indeterminate'}
                          value={progress?.percent ?? 0}
                          sx={{ height: 8, borderRadius: 4 }}
                        />
                        <Stack direction="row" justifyContent="space-between" mt={1}>
                          <Typography variant="caption" color="text.secondary">
                            Download in corso: {progress?.percent ?? 0}%
                          </Typography>
                          {progress && progress.totalMb > 0 && (
                            <Typography variant="caption" color="text.secondary">
                              {progress.downloadedMb.toFixed(1)} / {progress.totalMb.toFixed(1)} MB
                            </Typography>
                          )}
                        </Stack>
                      </Box>
                    ) : installPrompted ? (
                      <Alert severity="success" sx={{ mt: 1 }}>
                        Download completato. Segui le istruzioni sullo schermo per confermare l'installazione
                        dell'aggiornamento.
                      </Alert>
                    ) : (
                      <Button
                        variant="contained"
                        color="primary"
                        startIcon={<CloudDownloadIcon />}
                        onClick={handleStartDownload}
                        sx={{ mt: 1.5 }}
                        fullWidth
                      >
                        Scarica e installa aggiornamento
                      </Button>
                    )}
                  </Box>
                )}
              </>
            )}
          </Box>

          <Divider />

          {/* Sezione Dominio collegato (solo nativo) */}
          {native && (
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Configurazione dominio
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Dominio collegato:{' '}
                <strong>{appInfo?.domain || 'Nessun dominio salvato'}</strong>
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                Se il server o l'indirizzo IP del tuo gestionale è cambiato, puoi modificarlo da qui.
              </Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={handleOpenDomain}
                disabled={downloading}
              >
                Modifica dominio app
              </Button>
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        <Button onClick={onClose} disabled={downloading} color="inherit">
          Chiudi
        </Button>
      </DialogActions>
    </Dialog>
  );
}
