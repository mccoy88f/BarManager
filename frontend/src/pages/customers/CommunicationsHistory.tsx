import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { SUCCESS_CHIP_COLOR, ERROR_CHIP_COLOR, NEUTRAL_CHIP_COLOR } from '../../config/statusChip';
import { formatDateTime } from '../../utils/format';

type CommunicationType = 'COMMUNICATION' | 'MARKETING';
type RecipientStatus = 'QUEUED' | 'SENT' | 'FAILED';

interface CommunicationRow {
  id: string;
  type: CommunicationType;
  subject: string;
  status: 'QUEUED' | 'DONE';
  createdAt: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  recipientsCount: number;
  sentCount: number;
  failedCount: number;
  queuedCount: number;
  openedCount: number;
  clickedCount: number;
}

interface RecipientDetail {
  id: string;
  status: RecipientStatus;
  error: string | null;
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  customer: { firstName: string; lastName: string; email: string };
}

interface CommunicationDetail extends CommunicationRow {
  bodyHtml: string;
  recipients: RecipientDetail[];
}

const TYPE_LABELS: Record<CommunicationType, string> = {
  COMMUNICATION: 'Comunicazione',
  MARKETING: 'Marketing',
};

const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  QUEUED: 'In coda',
  SENT: 'Inviata',
  FAILED: 'Fallita',
};

const RECIPIENT_STATUS_COLOR: Record<RecipientStatus, 'default' | 'success' | 'error'> = {
  QUEUED: NEUTRAL_CHIP_COLOR,
  SENT: SUCCESS_CHIP_COLOR,
  FAILED: ERROR_CHIP_COLOR,
};

/** Ordine di visualizzazione dei gruppi nel dettaglio: prima gli esiti definitivi, poi chi è ancora in coda. */
const RECIPIENT_STATUS_ORDER: RecipientStatus[] = ['SENT', 'FAILED', 'QUEUED'];

/**
 * Storico delle comunicazioni inviate dalla pagina Marketing (§1-septdecies
 * di DEVELOPMENT.md): conteggio inviate/fallite/in coda per ogni invio
 * massivo, con drill-down sullo stato di ciascun destinatario — utile per
 * capire se una singola email in particolare non è arrivata, non solo se
 * "l'invio in generale" ha funzionato.
 */
export function CommunicationsHistory() {
  const navigate = useNavigate();
  const [detailId, setDetailId] = useState<string | null>(null);

  const historyQuery = useQuery({
    queryKey: ['communications', 'history'],
    queryFn: async () => (await api.get<CommunicationRow[]>('/communications')).data,
    refetchInterval: 10000, // per vedere avanzare l'invio in coda senza dover ricaricare la pagina a mano
  });

  const detailQuery = useQuery({
    queryKey: ['communications', 'detail', detailId],
    queryFn: async () => (await api.get<CommunicationDetail>(`/communications/${detailId}`)).data,
    enabled: !!detailId,
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5">Storico comunicazioni</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/customers/marketing')}>
          Nuova comunicazione
        </Button>
      </Box>

      <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Data</TableCell>
              <TableCell>Tipo</TableCell>
              <TableCell>Oggetto</TableCell>
              <TableCell>Destinatari</TableCell>
              <TableCell>Inviate</TableCell>
              <TableCell>Fallite</TableCell>
              <TableCell>In coda</TableCell>
              <TableCell>Aperti</TableCell>
              <TableCell>Click CTA</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(historyQuery.data ?? []).map((c) => (
              <TableRow key={c.id} hover sx={{ cursor: 'pointer' }} onClick={() => setDetailId(c.id)}>
                <TableCell>{formatDateTime(c.createdAt)}</TableCell>
                <TableCell>
                  <Chip size="small" label={TYPE_LABELS[c.type]} color={c.type === 'MARKETING' ? 'secondary' : 'default'} />
                </TableCell>
                <TableCell>{c.subject}</TableCell>
                <TableCell>{c.recipientsCount}</TableCell>
                <TableCell>{c.sentCount}</TableCell>
                <TableCell>
                  {c.failedCount > 0 ? <Chip size="small" color="error" label={c.failedCount} /> : c.failedCount}
                </TableCell>
                <TableCell>{c.queuedCount}</TableCell>
                <TableCell>{c.openedCount}</TableCell>
                <TableCell>{c.ctaLabel ? c.clickedCount : '—'}</TableCell>
                <TableCell>
                  <Button size="small" onClick={(e) => { e.stopPropagation(); setDetailId(c.id); }}>
                    Dettaglio
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {historyQuery.data?.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Nessuna comunicazione inviata finora.
        </Typography>
      )}

      <Dialog open={!!detailId} onClose={() => setDetailId(null)} maxWidth="md" fullWidth>
        <DialogTitle>{detailQuery.data?.subject ?? 'Dettaglio comunicazione'}</DialogTitle>
        <DialogContent sx={{ pt: 4 }}>
          {detailQuery.data && (
            <Accordion sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Contenuto dell'email inviata</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
                <Box
                  sx={{ '& img, & video': { maxWidth: '100%' } }}
                  dangerouslySetInnerHTML={{ __html: detailQuery.data.bodyHtml }}
                />
              </AccordionDetails>
            </Accordion>
          )}

          {RECIPIENT_STATUS_ORDER.map((status) => {
            const group = detailQuery.data?.recipients.filter((r) => r.status === status) ?? [];
            if (group.length === 0) return null;
            return (
              <Box key={status} sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Chip size="small" label={RECIPIENT_STATUS_LABELS[status]} color={RECIPIENT_STATUS_COLOR[status]} />
                  {group.length}
                </Typography>
                <List dense>
                  {group.map((r) => {
                    const trackingNotes = [
                      r.openedAt ? `Aperta il ${formatDateTime(r.openedAt)}` : null,
                      r.clickedAt ? `Click CTA il ${formatDateTime(r.clickedAt)}` : null,
                    ].filter(Boolean);
                    return (
                      <ListItem key={r.id} disableGutters sx={{ alignItems: 'flex-start' }}>
                        <ListItemText
                          primary={`${r.customer.firstName} ${r.customer.lastName} — ${r.customer.email}`}
                          secondary={
                            <>
                              {r.status === 'FAILED' && r.error
                                ? `Fallita: ${r.error}`
                                : r.status === 'SENT' && r.sentAt
                                  ? `Inviata il ${formatDateTime(r.sentAt)}`
                                  : RECIPIENT_STATUS_LABELS[r.status]}
                              {trackingNotes.length > 0 && (
                                <Typography variant="caption" color="text.secondary" display="block">
                                  {trackingNotes.join(' · ')}
                                </Typography>
                              )}
                            </>
                          }
                        />
                      </ListItem>
                    );
                  })}
                </List>
              </Box>
            );
          })}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
