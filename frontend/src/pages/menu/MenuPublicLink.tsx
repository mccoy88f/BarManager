import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import QRCode from 'qrcode';

/** Link e QR code del menù pubblico, in una pagina propria richiamata da MenuAdmin. */
export function MenuPublicLink() {
  const navigate = useNavigate();
  const publicMenuUrl = `${window.location.origin}/menu`;
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');

  useEffect(() => {
    QRCode.toDataURL(publicMenuUrl, { width: 320, margin: 1 })
      .then(setQrCodeDataUrl)
      .catch(() => setQrCodeDataUrl(''));
  }, [publicMenuUrl]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        sx={{ justifySelf: 'flex-start' }}
        onClick={() => navigate('/menu/admin')}
      >
        Menù
      </Button>

      <Box>
        <Typography variant="h5" fontWeight={700}>
          Link e QR code del menù pubblico
        </Typography>
        <Typography variant="body2" color="text.secondary">
          I clienti possono vedere il menù, senza login, a questo indirizzo o scansionando il QR
          code.
        </Typography>
      </Box>

      <Card variant="outlined">
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems="center">
            <Stack spacing={1} sx={{ flexGrow: 1, width: '100%' }}>
              <TextField
                label="URL menù pubblico"
                value={publicMenuUrl}
                size="small"
                InputProps={{ readOnly: true }}
                onFocus={(e) => e.target.select()}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => navigator.clipboard?.writeText(publicMenuUrl)}
                >
                  Copia link
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  component="a"
                  href={publicMenuUrl}
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
                  alt="QR code menù pubblico"
                  sx={{ width: 160, height: 160 }}
                />
                <Button variant="contained" size="small" component="a" href={qrCodeDataUrl} download="menu-qrcode.png">
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
