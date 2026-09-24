import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
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
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { SUCCESS_CHIP_COLOR, ERROR_CHIP_COLOR, NEUTRAL_CHIP_COLOR } from '../../config/statusChip';

type CommunicationType = 'COMMUNICATION' | 'MARKETING';
type RecipientStatus = 'QUEUED' | 'SENT' | 'FAILED';

interface CommunicationRow {
  id: string;
  type: CommunicationType;
  subject: string;
  status: 'QUEUED' | 'DONE';
  createdAt: string;
  recipientsCount: number;
  sentCount: number;
  failedCount: number;
  queuedCount: number;
}

interface RecipientDetail {
  id: string;
  status: RecipientStatus;
  error: string | null;
  sentAt: string | null;
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('it-IT');
}

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

      <Dialog open={!!detailId} onClose={() => setDetailId(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detailQuery.data?.subject ?? 'Dettaglio comunicazione'}</DialogTitle>
        <DialogContent sx={{ pt: 4 }}>
          <List dense>
            {detailQuery.data?.recipients.map((r) => (
              <ListItem key={r.id} disableGutters>
                <ListItemText
                  primary={`${r.customer.firstName} ${r.customer.lastName} — ${r.customer.email}`}
                  secondary={
                    r.status === 'FAILED' && r.error
                      ? `Fallita: ${r.error}`
                      : r.status === 'SENT' && r.sentAt
                        ? `Inviata il ${formatDateTime(r.sentAt)}`
                        : RECIPIENT_STATUS_LABELS[r.status]
                  }
                />
                <Chip
                  size="small"
                  label={RECIPIENT_STATUS_LABELS[r.status]}
                  color={RECIPIENT_STATUS_COLOR[r.status]}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
