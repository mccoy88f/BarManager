import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface PrivacyPageData {
  firstName: string;
  lastName: string;
  email: string;
  marketingConsent: boolean;
  venueName: string;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Operazione non riuscita. Il link potrebbe essere scaduto o già usato.';
}

/**
 * Pagina pubblica "gestisci i tuoi dati personali" (§5.8 di
 * DEVELOPMENT.md), senza login: raggiunta dal link in fondo alle email di
 * prenotazione, sullo stesso principio di una pagina di cancellazione da
 * una mailing list. Due sole azioni, non distruttive per il resto del
 * sistema: rimuovere il consenso marketing, o eliminare la propria scheda
 * cliente (non le prenotazioni già effettuate, che restano nello storico
 * del locale — dichiarato esplicitamente qui prima di confermare).
 */
export function PublicPrivacyManage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';

  const [optedOut, setOptedOut] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const query = useQuery({
    queryKey: ['public-privacy-manage', token],
    queryFn: async () => (await api.get<PrivacyPageData>('/public/customers/privacy', { params: { token } })).data,
    enabled: !!token,
  });

  const optOutMutation = useMutation({
    mutationFn: async () => (await api.patch('/public/customers/privacy/opt-out', null, { params: { token } })).data,
    onSuccess: () => setOptedOut(true),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => (await api.delete('/public/customers/privacy', { params: { token } })).data,
    onSuccess: () => {
      setConfirmDeleteOpen(false);
      setDeleted(true);
    },
  });

  if (!token) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 6, px: 2 }}>
        <Alert severity="error">Link non valido.</Alert>
      </Box>
    );
  }

  if (query.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (deleted) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 6, px: 2 }}>
        <Alert severity="success">
          I tuoi dati sono stati eliminati. Le prenotazioni già effettuate restano nello storico
          del locale, come previsto.
        </Alert>
      </Box>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 6, px: 2 }}>
        <Alert severity="error">Link non valido o già usato.</Alert>
      </Box>
    );
  }

  const { firstName, lastName, email, venueName } = query.data;
  const marketingConsent = optedOut ? false : query.data.marketingConsent;

  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, py: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        I tuoi dati personali — {venueName}
      </Typography>

      <Card variant="outlined">
        <CardContent sx={{ display: 'grid', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {firstName} {lastName} — {email}
          </Typography>

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Comunicazioni promozionali (marketing)
            </Typography>
            {marketingConsent ? (
              <>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Al momento accetti di ricevere comunicazioni promozionali da {venueName}.
                </Typography>
                {optOutMutation.isError && (
                  <Alert severity="error" sx={{ mb: 1 }}>{extractErrorMessage(optOutMutation.error)}</Alert>
                )}
                <Button
                  variant="outlined"
                  disabled={optOutMutation.isPending}
                  onClick={() => optOutMutation.mutate()}
                >
                  Non voglio più ricevere comunicazioni promozionali
                </Button>
              </>
            ) : (
              <Alert severity="success">
                {optedOut
                  ? 'Consenso rimosso: non riceverai più comunicazioni promozionali.'
                  : 'Non hai dato il consenso a ricevere comunicazioni promozionali.'}
              </Alert>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Elimina i tuoi dati
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Elimina la tua scheda cliente presso {venueName} (nome, email, telefono, note,
              consenso marketing). Le prenotazioni già effettuate restano nello storico del
              locale e non vengono eliminate da questa azione.
            </Typography>
            {deleteMutation.isError && (
              <Alert severity="error" sx={{ mb: 1 }}>{extractErrorMessage(deleteMutation.error)}</Alert>
            )}
            <Button
              variant="outlined"
              color="error"
              disabled={deleteMutation.isPending}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Elimina i miei dati
            </Button>
          </Box>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Eliminare i tuoi dati?"
        message={`La tua scheda cliente presso ${venueName} verrà eliminata definitivamente. Le prenotazioni già effettuate restano nello storico del locale.`}
        confirmLabel="Elimina i miei dati"
        loading={deleteMutation.isPending}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Box>
  );
}
