import { useEffect, useState } from 'react';
import { Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { isNativeApp, AppSettings } from '../../printing/nativePrint';

/**
 * Visibile solo dentro l'app Android nativa BarManager (mai su sito/PWA):
 * il dominio a cui l'app punta vive fuori dalla WebView, in storage
 * nativo, quindi va cambiato da uno schermo nativo (§5.11 di
 * docs/DEVELOPMENT.md) — questo pulsante lo apre, invece di duplicare un
 * form di configurazione dentro la pagina web.
 */
export function AppDomainCard() {
  const [domain, setDomain] = useState<string | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    AppSettings.getDomain().then((res) => setDomain(res.domain));
  }, []);

  if (!isNativeApp()) return null;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <div>
            <Typography variant="h6">App Android</Typography>
            <Typography variant="body2" color="text.secondary">
              Dominio collegato: {domain ?? '—'}
            </Typography>
          </div>
          <Button variant="outlined" onClick={() => AppSettings.openDomainSettings()}>
            Cambia dominio app
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
