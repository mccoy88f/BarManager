import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  Radio,
  RadioGroup,
  Step,
  StepLabel,
  Stepper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useToast } from '../../components/ToastProvider';
import { RichTextEditor, RichTextEditorHandle } from '../../components/RichTextEditor';

type CommunicationType = 'COMMUNICATION' | 'MARKETING';

interface TargetableCustomer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  marketingConsent: boolean;
}

const STEPS = ['Tipo di email', 'Destinatari', 'Contenuto'];
const PLACEHOLDERS: Array<{ token: string; label: string }> = [
  { token: '{nome}', label: 'Nome' },
  { token: '{cognome}', label: 'Cognome' },
  { token: '{email}', label: 'Email' },
];

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return "Errore durante l'invio della comunicazione.";
}

/**
 * Pagina Marketing (§1-septdecies di DEVELOPMENT.md): invio di comunicazioni
 * email ai clienti in anagrafica, in 3 passaggi — il tipo va scelto per
 * primo perché determina chi è selezionabile come destinatario nel passo
 * successivo (per "Marketing" solo chi ha dato il consenso). Il contenuto
 * usa lo stesso editor ricco di KBpedia, con placeholder sui campi del
 * cliente sostituiti dal backend un destinatario alla volta al momento
 * dell'invio, non qui in anteprima.
 */
export function Marketing() {
  const navigate = useNavigate();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const editorRef = useRef<RichTextEditorHandle>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [type, setType] = useState<CommunicationType | ''>('');
  const [allCustomers, setAllCustomers] = useState(true);
  const [selected, setSelected] = useState<TargetableCustomer[]>([]);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');

  const targetableQuery = useQuery({
    queryKey: ['communications', 'targetable-customers', type],
    queryFn: async () =>
      (await api.get<TargetableCustomer[]>('/communications/targetable-customers', { params: { type } })).data,
    enabled: !!type,
  });

  const sendMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/communications', {
          type,
          subject,
          bodyHtml,
          allCustomers,
          customerIds: allCustomers ? undefined : selected.map((c) => c.id),
        })
      ).data,
    onSuccess: () => {
      showToast('Comunicazione accodata: verrà inviata a breve, un destinatario alla volta.');
      queryClient.invalidateQueries({ queryKey: ['communications', 'history'] });
      navigate('/customers/communications');
    },
  });

  const targetable = targetableQuery.data ?? [];
  const canGoToRecipients = !!type;
  const recipientsCount = allCustomers ? targetable.length : selected.length;
  const canGoToContent = recipientsCount > 0;
  const canSend = subject.trim().length > 0 && bodyHtml.trim().length > 0 && recipientsCount > 0;

  const insertPlaceholder = (token: string, focusSubject: boolean) => {
    if (focusSubject && subjectRef.current) {
      const input = subjectRef.current;
      const start = input.selectionStart ?? subject.length;
      const end = input.selectionEnd ?? subject.length;
      const next = subject.slice(0, start) + token + subject.slice(end);
      setSubject(next);
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      editorRef.current?.insertText(token);
    }
  };

  const placeholderButtons = useMemo(
    () => (focusSubject: boolean) => (
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 0.5 }}>
          Inserisci campo:
        </Typography>
        {PLACEHOLDERS.map((p) => (
          <Chip
            key={p.token}
            size="small"
            label={`${p.label} ${p.token}`}
            onClick={() => insertPlaceholder(p.token, focusSubject)}
            variant="outlined"
          />
        ))}
      </Stack>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject],
  );

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Marketing — nuova comunicazione
      </Typography>

      <Stepper activeStep={step} sx={{ mb: 3 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Card>
        <CardContent sx={{ display: 'grid', gap: 2 }}>
          {step === 0 && (
            <>
              <Typography variant="body2" color="text.secondary">
                Il tipo scelto determina chi potrà essere selezionato come destinatario al passo successivo.
              </Typography>
              <RadioGroup
                value={type}
                onChange={(e) => {
                  // Cambiare tipo dopo aver scelto dei destinatari può renderli
                  // non più ammessi (es. da Marketing a una selezione con
                  // clienti senza consenso): si riparte da "tutti" per non
                  // portarsi dietro per errore una selezione non valida.
                  setType(e.target.value as CommunicationType);
                  setAllCustomers(true);
                  setSelected([]);
                }}
              >
                <FormControlLabel
                  value="COMMUNICATION"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography fontWeight={600}>Comunicazione</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Avviso non promozionale (es. chiusura, cambio orari): può essere inviato a tutti i clienti o a
                        una selezione, indipendentemente dal consenso marketing.
                      </Typography>
                    </Box>
                  }
                  sx={{ mb: 2, alignItems: 'flex-start' }}
                />
                <FormControlLabel
                  value="MARKETING"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography fontWeight={600}>Marketing/Pubblicità</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Promozioni e offerte: selezionabili solo i clienti che hanno dato il consenso marketing.
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'flex-start' }}
                />
              </RadioGroup>
            </>
          )}

          {step === 1 && (
            <>
              <RadioGroup
                value={allCustomers ? 'all' : 'some'}
                onChange={(e) => setAllCustomers(e.target.value === 'all')}
              >
                <FormControlLabel value="all" control={<Radio />} label="Tutti i clienti ammessi" />
                <FormControlLabel value="some" control={<Radio />} label="Solo alcuni clienti" />
              </RadioGroup>

              {type === 'MARKETING' && (
                <Alert severity="info">
                  Solo i clienti con consenso marketing sono selezionabili ({targetable.length} su questo locale).
                </Alert>
              )}

              {!allCustomers && (
                <Autocomplete
                  multiple
                  loading={targetableQuery.isLoading}
                  options={targetable}
                  value={selected}
                  onChange={(_e, value) => setSelected(value)}
                  getOptionLabel={(c) => `${c.firstName} ${c.lastName} — ${c.email}`}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  disableCloseOnSelect
                  renderInput={(params) => (
                    <TextField {...params} label="Clienti destinatari" placeholder="Cerca un cliente..." />
                  )}
                />
              )}

              <Typography variant="body2" color="text.secondary">
                Destinatari selezionati: {recipientsCount}
              </Typography>
            </>
          )}

          {step === 2 && (
            <>
              {placeholderButtons(true)}
              <TextField
                inputRef={subjectRef}
                label="Oggetto"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                fullWidth
              />

              {placeholderButtons(false)}
              <RichTextEditor ref={editorRef} value={bodyHtml} onChange={setBodyHtml} />

              {sendMutation.isError && <Alert severity="error">{extractErrorMessage(sendMutation.error)}</Alert>}
            </>
          )}

          <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
            <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              Indietro
            </Button>
            {step < 2 ? (
              <Button
                variant="contained"
                disabled={step === 0 ? !canGoToRecipients : !canGoToContent}
                onClick={() => setStep((s) => s + 1)}
              >
                Avanti
              </Button>
            ) : (
              <Button
                variant="contained"
                disabled={!canSend || sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
              >
                Accoda e invia
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
