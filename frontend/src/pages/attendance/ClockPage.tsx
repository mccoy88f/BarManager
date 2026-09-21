import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Button, Card, CardContent, Typography, CircularProgress, Alert } from '@mui/material';
import { api } from '../../api/client';

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore nella registrazione, riprova.';
}

/**
 * Pagina raggiunta inquadrando il QR di una postazione (/clock/:token).
 * Mostra un solo grande pulsante: "Inizio turno" o "Fine turno", in base
 * all'ultimo evento registrato per il dipendente loggato.
 */
export function ClockPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['attendance-status'],
    queryFn: async () => (await api.get('/attendance/me/status')).data,
  });

  const clockMutation = useMutation({
    mutationFn: async () => (await api.post('/attendance/clock', { qrToken: token })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attendance-status'] }),
  });

  if (statusQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const nextAction = statusQuery.data?.nextAction;
  const isStart = nextAction === 'CLOCK_IN';

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
      <Card sx={{ maxWidth: 360, width: '100%' }}>
        <CardContent sx={{ textAlign: 'center', p: 4 }}>
          <Typography variant="h6" gutterBottom>
            Timbratura
          </Typography>

          {clockMutation.isSuccess && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Registrato alle {new Date(clockMutation.data.timestamp).toLocaleTimeString('it-IT')}
            </Alert>
          )}
          {clockMutation.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {extractErrorMessage(clockMutation.error)}
            </Alert>
          )}

          <Button
            variant="contained"
            color={isStart ? 'primary' : 'secondary'}
            size="large"
            fullWidth
            sx={{ py: 3, fontSize: 20 }}
            disabled={clockMutation.isPending}
            onClick={() => clockMutation.mutate()}
          >
            {isStart ? 'Inizio turno' : 'Fine turno'}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
