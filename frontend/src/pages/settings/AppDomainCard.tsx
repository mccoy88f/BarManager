import { useEffect, useState } from 'react';
import { Button, Card, CardContent, Stack, Typography } from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import { isNativeApp, appSettings } from '../../printing/nativePrint';
import { AppSettingsDialog } from '../../components/AppSettingsDialog';

/**
 * Visibile solo dentro l'app Android nativa BarManager (mai su sito/PWA):
 * il dominio a cui l'app punta vive fuori dalla WebView, in storage
 * nativo, quindi va cambiato da uno schermo nativo (§5.11 di
 * docs/DEVELOPMENT.md). Permette anche di verificare gli aggiornamenti
 * dell'app da GitHub Releases.
 */
export function AppDomainCard() {
  const [domain, setDomain] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    appSettings()
      .then(({ plugin }) => plugin.getDomain())
      .then((res) => setDomain(res.domain));
  }, []);

  if (!isNativeApp()) return null;

  return (
    <>
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
            <div>
              <Typography variant="h6">App Android</Typography>
              <Typography variant="body2" color="text.secondary">
                Dominio collegato: {domain ?? '—'}
              </Typography>
            </div>
            <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
              <Button
                variant="contained"
                size="small"
                startIcon={<SystemUpdateAltIcon />}
                onClick={() => setDialogOpen(true)}
              >
                Verifica aggiornamenti
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => appSettings().then(({ plugin }) => plugin.openDomainSettings())}
              >
                Cambia dominio
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
      <AppSettingsDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
