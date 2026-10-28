import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import QRCode from 'qrcode';
import { useToast } from '../../components/ToastProvider';

/** Link e QR code della pagina pubblica /display, come OnlineOrdersPublicLink.tsx per /ordina. */
export function DisplayPromoLink() {
  const navigate = useNavigate();
  const showToast = useToast();
  const publicDisplayUrl = `${window.location.origin}/display`;
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');

  useEffect(() => {
    QRCode.toDataURL(publicDisplayUrl, { width: 320, margin: 1 })
      .then(setQrCodeDataUrl)
      .catch(() => setQrCodeDataUrl(''));
  }, [publicDisplayUrl]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Button startIcon={<ArrowBackIcon />} sx={{ justifySelf: 'flex-start' }} onClick={() => navigate('/display-promo')}>
        Display Promo
      </Button>

      <Box>
        <Typography variant="h5" fontWeight={700}>
          Link e QR code del display pubblico
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Apri questo indirizzo sullo schermo/tablet collegato (a tutto schermo, orizzontale o
          verticale): mostrerà in loop la playlist del turno corrente, senza bisogno di login.
        </Typography>
      </Box>

      <Card variant="outlined">
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems="center">
            <Stack spacing={1} sx={{ flexGrow: 1, width: '100%' }}>
              <TextField
                label="URL display"
                value={publicDisplayUrl}
                size="small"
                InputProps={{ readOnly: true }}
                onFocus={(e) => e.target.select()}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() =>
                    navigator.clipboard?.writeText(publicDisplayUrl).then(() => showToast('Link copiato'))
                  }
                >
                  Copia link
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  component="a"
                  href={publicDisplayUrl}
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
                  alt="QR code display"
                  sx={{ width: 160, height: 160 }}
                />
                <Button
                  variant="contained"
                  size="small"
                  component="a"
                  href={qrCodeDataUrl}
                  download="display-promo-qrcode.png"
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
