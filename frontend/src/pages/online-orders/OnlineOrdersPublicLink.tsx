import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import QRCode from 'qrcode';
import { useToast } from '../../components/ToastProvider';

/** Link e QR code del checkout ordini online pubblico, come MenuPublicLink.tsx per /menu. */
export function OnlineOrdersPublicLink() {
  const navigate = useNavigate();
  const showToast = useToast();
  const publicOrderUrl = `${window.location.origin}/ordina`;
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');

  useEffect(() => {
    QRCode.toDataURL(publicOrderUrl, { width: 320, margin: 1 })
      .then(setQrCodeDataUrl)
      .catch(() => setQrCodeDataUrl(''));
  }, [publicOrderUrl]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        sx={{ justifySelf: 'flex-start' }}
        onClick={() => navigate('/online-orders')}
      >
        Ordini online
      </Button>

      <Box>
        <Typography variant="h5" fontWeight={700}>
          Link e QR code degli ordini online
        </Typography>
        <Typography variant="body2" color="text.secondary">
          I clienti possono ordinare online, senza login, a questo indirizzo o scansionando il QR
          code.
        </Typography>
      </Box>

      <Card variant="outlined">
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems="center">
            <Stack spacing={1} sx={{ flexGrow: 1, width: '100%' }}>
              <TextField
                label="URL ordini online"
                value={publicOrderUrl}
                size="small"
                InputProps={{ readOnly: true }}
                onFocus={(e) => e.target.select()}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() =>
                    navigator.clipboard?.writeText(publicOrderUrl).then(() => showToast('Link copiato'))
                  }
                >
                  Copia link
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  component="a"
                  href={publicOrderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Apri link
                </Button>
              </Stack>
            </Stack>
            {qrCodeDataUrl && (
              <Stack spacing={1} alignItems="center">
                <Box
                  component="img"
                  src={qrCodeDataUrl}
                  alt="QR code ordini online"
                  sx={{ width: 160, height: 160 }}
                />
                <Button
                  variant="contained"
                  size="small"
                  component="a"
                  href={qrCodeDataUrl}
                  download="ordini-online-qrcode.png"
                >
                  Scarica QR code
                </Button>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
