import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { deliverPrintJob, type PrintJobResponse } from '../../printing/printJob';
import type { Fridge } from './Fridges';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/**
 * Tabella con tutti i frigo/congelatori alla data odierna: un rigo per
 * frigo, inserimento del valore rilevato e, se fuori soglia, dell'azione
 * correttiva (obbligatoria lato backend). In fondo, firma e stampa del
 * report giornaliero sulla stampante HACCP configurata.
 */
export function TemperatureEntry() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [corrective, setCorrective] = useState<Record<string, string>>({});
  const [printOpen, setPrintOpen] = useState(false);
  const [signedByName, setSignedByName] = useState('');
  const [printError, setPrintError] = useState<string | null>(null);
  const [printSuccess, setPrintSuccess] = useState<string | null>(null);

  const today = todayIso();

  const fridgesQuery = useQuery({
    queryKey: ['fridges'],
    queryFn: async () => (await api.get<Fridge[]>('/haccp/fridges')).data,
  });

  const todayReadingsQuery = useQuery({
    queryKey: ['readings', today],
    queryFn: async () =>
      (await api.get('/haccp/readings', { params: { from: today, to: today } })).data as Array<{
        id: string;
        fridgeId: string;
        value: number;
        outOfRange: boolean;
      }>,
  });

  const submitMutation = useMutation({
    mutationFn: async (fridgeId: string) =>
      (
        await api.post('/haccp/readings', {
          fridgeId,
          value: Number(values[fridgeId]),
          correctiveAction: corrective[fridgeId],
        })
      ).data,
    onSuccess: (_, fridgeId) => {
      setValues((v) => ({ ...v, [fridgeId]: '' }));
      setCorrective((c) => ({ ...c, [fridgeId]: '' }));
      queryClient.invalidateQueries({ queryKey: ['readings'] });
    },
  });

  const printMutation = useMutation({
    mutationFn: async () => {
      const job = (
        await api.post<PrintJobResponse>('/haccp/report/print-job', { reportDate: today })
      ).data;
      const outcome = await deliverPrintJob(job);
      await api.post('/haccp/report/print', {
        reportDate: today,
        signedByName: signedByName.trim(),
        printedOnPos: outcome.printed,
      });
      return outcome;
    },
    onSuccess: (outcome) => {
      setPrintError(null);
      setPrintSuccess(
        outcome.printed
          ? 'Report registrato: dialogo di stampa aperto.'
          : 'Report registrato e firmato (nessuna stampante configurata per HACCP: Impostazioni > Stampanti).',
      );
      setPrintOpen(false);
      setSignedByName('');
    },
    onError: (err) => setPrintError(extractErrorMessage(err)),
  });

  const readingsByFridge = new Map(
    (todayReadingsQuery.data ?? []).map((r) => [r.fridgeId, r]),
  );

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">
            Rilevazione temperature — {new Date().toLocaleDateString('it-IT')}
          </Typography>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => {
              setPrintError(null);
              setPrintOpen(true);
            }}
          >
            Firma e stampa report
          </Button>
        </Box>

        {printSuccess && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setPrintSuccess(null)}>
            {printSuccess}
          </Alert>
        )}

        <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Frigo/Congelatore</TableCell>
                <TableCell>Range</TableCell>
                <TableCell>Già registrato oggi</TableCell>
                <TableCell>Valore rilevato</TableCell>
                <TableCell>Azione correttiva</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {fridgesQuery.data?.map((fridge) => {
                const value = values[fridge.id] ?? '';
                const numValue = Number(value);
                const outOfRange =
                  value !== '' && (numValue < fridge.minTemp || numValue > fridge.maxTemp);
                const alreadyToday = readingsByFridge.get(fridge.id);

                return (
                  <TableRow key={fridge.id}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {fridge.label}
                      </Typography>
                      {fridge.location && (
                        <Typography variant="caption" color="text.secondary">
                          {fridge.location}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {fridge.minTemp}°C / {fridge.maxTemp}°C
                    </TableCell>
                    <TableCell>
                      {alreadyToday ? (
                        <Chip
                          size="small"
                          color={alreadyToday.outOfRange ? 'warning' : 'success'}
                          label={`${alreadyToday.value}°C`}
                        />
                      ) : (
                        <Chip size="small" variant="outlined" label="Nessuna" />
                      )}
                    </TableCell>
                    <TableCell>
                      <TextField
                        label="°C"
                        type="number"
                        size="small"
                        value={value}
                        onChange={(e) => setValues((v) => ({ ...v, [fridge.id]: e.target.value }))}
                        sx={{ width: 100 }}
                      />
                    </TableCell>
                    <TableCell>
                      {outOfRange && (
                        <TextField
                          label="Obbligatoria: fuori soglia"
                          size="small"
                          value={corrective[fridge.id] ?? ''}
                          onChange={(e) =>
                            setCorrective((c) => ({ ...c, [fridge.id]: e.target.value }))
                          }
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={
                          value === '' ||
                          (outOfRange && !corrective[fridge.id]) ||
                          submitMutation.isPending
                        }
                        onClick={() => submitMutation.mutate(fridge.id)}
                      >
                        Registra
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        {fridgesQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Nessun frigorifero censito: aggiungine uno qui sopra.
          </Typography>
        )}
      </CardContent>

      <Dialog open={printOpen} onClose={() => setPrintOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Firma e stampa report di oggi</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 3 }}>
          <TextField
            label="Nome di chi firma"
            value={signedByName}
            onChange={(e) => setSignedByName(e.target.value)}
            autoFocus
          />
          {printError && <Alert severity="error">{printError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setPrintOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!signedByName.trim() || printMutation.isPending}
            onClick={() => printMutation.mutate()}
          >
            Firma e stampa
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
