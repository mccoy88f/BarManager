import { useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api } from '../../api/client';

interface QrTokenRow {
  id: string;
  token: string;
  label: string;
  active: boolean;
}

function QrTokenCard({ qrToken }: { qrToken: QrTokenRow }) {
  const [dataUrl, setDataUrl] = useState('');
  const clockUrl = `${window.location.origin}/clock/${qrToken.token}`;

  useEffect(() => {
    QRCode.toDataURL(clockUrl, { width: 280, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(''));
  }, [clockUrl]);

  return (
    <Card variant="outlined">
      <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {qrToken.label}
        </Typography>
        {dataUrl && (
          <Box component="img" src={dataUrl} alt={`QR ${qrToken.label}`} sx={{ width: 180, height: 180 }} />
        )}
        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all', textAlign: 'center' }}>
          {clockUrl}
        </Typography>
        {dataUrl && (
          <Button
            size="small"
            variant="outlined"
            component="a"
            href={dataUrl}
            download={`qrcode-${qrToken.label.replace(/\s+/g, '-').toLowerCase()}.png`}
          >
            Scarica QR code
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Postazioni QR per la timbratura: ogni QR punta a /clock/:token, che il
 * dipendente apre già loggato (da app installata o browser) per registrare
 * inizio/fine turno.
 */
export function QrTokens() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');

  const tokensQuery = useQuery({
    queryKey: ['attendance-qr-tokens'],
    queryFn: async () => (await api.get<QrTokenRow[]>('/attendance/qr-tokens')).data,
  });

  const createMutation = useMutation({
    mutationFn: async () => (await api.post('/attendance/qr-tokens', { label })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-qr-tokens'] });
      setLabel('');
    },
  });

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Nuova postazione QR
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Stampa il QR e affiggilo alla postazione (es. ingresso cucina): i dipendenti lo
            inquadrano per timbrare inizio/fine turno.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Nome postazione"
              size="small"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Button
              variant="contained"
              disabled={!label || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Genera QR
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Stack direction="row" flexWrap="wrap" gap={2}>
        {tokensQuery.data?.map((qrToken) => (
          <Box key={qrToken.id} sx={{ width: 220 }}>
            <QrTokenCard qrToken={qrToken} />
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
