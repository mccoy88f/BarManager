import { useState } from 'react';
import { Button, Card, CardContent, Stack, Typography } from '@mui/material';
import SecurityIcon from '@mui/icons-material/Security';
import { useToast } from './ToastProvider';
import { requestDevicePermissions } from '../utils/devicePermissions';

/** Pulsante per rifare chiedere notifiche, fotocamera e posizione su questo dispositivo. */
export function DevicePermissionsCard() {
  const showToast = useToast();
  const [pending, setPending] = useState(false);

  const ask = async () => {
    setPending(true);
    try {
      const result = await requestDevicePermissions();
      showToast({ message: result.message, severity: result.ok ? 'success' : 'warning' });
    } catch {
      showToast({ message: 'Impossibile richiedere le autorizzazioni.', severity: 'error' });
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }}>
          <div>
            <Typography variant="h6">Autorizzazioni dispositivo</Typography>
            <Typography variant="body2" color="text.secondary">
              Notifiche per aggiornamenti, prenotazioni e ordini. Fotocamera per i QR di timbratura. Posizione per timbrare sul posto.
            </Typography>
          </div>
          <Button
            variant="outlined"
            startIcon={<SecurityIcon />}
            disabled={pending}
            onClick={() => void ask()}
            sx={{ flexShrink: 0 }}
          >
            Richiedi autorizzazioni dispositivo
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
