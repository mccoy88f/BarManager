import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import PrintIcon from '@mui/icons-material/Print';
import EventNoteIcon from '@mui/icons-material/EventNote';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { shareReceiptPdf } from '../../printing/printJob';
import { useToast } from '../../components/ToastProvider';
import { useAuthStore } from '../../store/authStore';
import { canAccessModule } from '../../config/modules';
import { EmailStatusIndicator, statusLabels, statusColor, OrderRow as OrderHistoryRow } from './OrderHistory';

interface OrderLineRow {
  id: string;
  orderedQty: number;
  product: { name: string; unit: string; costPerUnit?: number };
}

interface OrderRow extends OrderHistoryRow {
  createdBy: { email: string };
  lines: OrderLineRow[];
}

function orderTotal(order: OrderRow): number {
  return order.lines.reduce((sum, l) => sum + (l.product.costPerUnit ?? 0) * l.orderedQty, 0);
}

/** Dettaglio di un ordine dello storico, come pagina propria (non un modale). */
export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [paymentTaskOpen, setPaymentTaskOpen] = useState(false);
  const [paymentTaskDueDate, setPaymentTaskDueDate] = useState('');

  const orderQuery = useQuery({
    queryKey: ['order', id],
    queryFn: async () => (await api.get<OrderRow>(`/inventory/orders/${id}`)).data,
  });

  const printMutation = useMutation({
    mutationFn: async () => {
      const response = await api.get(`/inventory/orders/${id}/export/pdf`, {
        responseType: 'blob',
      });
      await shareReceiptPdf(response.data, `Ordine ${id}`);
    },
    onSuccess: () => showToast('Ricevuta condivisa per la stampa.'),
    onError: () => showToast({ message: 'Ristampa non riuscita.', severity: 'error' }),
  });

  /** "Genera scadenza di pagamento" (§5.5): crea un'Attività collegata a questo ordine. */
  const paymentTaskMutation = useMutation({
    mutationFn: async () =>
      (await api.post(`/inventory/orders/${id}/payment-task`, { dueDate: paymentTaskDueDate })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setPaymentTaskOpen(false);
      setPaymentTaskDueDate('');
      showToast('Scadenza di pagamento creata in Attività.');
    },
    onError: () => showToast({ message: 'Creazione scadenza non riuscita.', severity: 'error' }),
  });

  const downloadPdf = async () => {
    const response = await api.get(`/inventory/orders/${id}/export/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ordine-${id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!orderQuery.data) return null;
  const order = orderQuery.data;
  const total = orderTotal(order);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        sx={{ justifySelf: 'flex-start' }}
        onClick={() => navigate('/inventory/orders-history')}
      >
        Storico ordini
      </Button>

      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {order.supplier.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Ordinato il {new Date(order.createdAt).toLocaleDateString('it-IT')} da {order.createdBy.email}
          </Typography>
          {order.sentAt && (
            <Typography variant="body2" color="text.secondary">
              Inviato il {new Date(order.sentAt).toLocaleDateString('it-IT')}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <EmailStatusIndicator emailSent={order.emailSent} emailError={order.emailError} />
          <Chip color={statusColor[order.status]} label={statusLabels[order.status]} />
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={downloadPdf}>
          Esporta PDF
        </Button>
        <Button
          variant="outlined"
          startIcon={<PrintIcon />}
          disabled={printMutation.isPending}
          onClick={() => printMutation.mutate()}
        >
          Condividi per la stampa
        </Button>
        {total > 0 && canAccessModule(user, 'tasks') && (
          <Button variant="outlined" startIcon={<EventNoteIcon />} onClick={() => setPaymentTaskOpen(true)}>
            Genera scadenza di pagamento
          </Button>
        )}
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Prodotto</TableCell>
                  <TableCell>Quantità</TableCell>
                  <TableCell align="right">Costo unitario</TableCell>
                  <TableCell align="right">Subtotale</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {order.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.product.name}</TableCell>
                    <TableCell>
                      {line.orderedQty} {line.product.unit}
                    </TableCell>
                    <TableCell align="right">
                      {line.product.costPerUnit != null ? `€ ${line.product.costPerUnit.toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {line.product.costPerUnit != null
                        ? `€ ${(line.product.costPerUnit * line.orderedQty).toFixed(2)}`
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {total > 0 && (
            <Typography variant="h6" sx={{ mt: 2, textAlign: 'right' }}>
              Totale: € {total.toFixed(2)}
            </Typography>
          )}
        </CardContent>
      </Card>

      <Dialog open={paymentTaskOpen} onClose={() => setPaymentTaskOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Genera scadenza di pagamento</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
          <Alert severity="info">
            Crea un'attività di tipo "Pagamento fornitore" per € {total.toFixed(2)}, collegata a
            questo ordine. Scegli quando scade il pagamento.
          </Alert>
          <TextField
            label="Scadenza"
            type="date"
            InputLabelProps={{ shrink: true }}
            value={paymentTaskDueDate}
            onChange={(e) => setPaymentTaskDueDate(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setPaymentTaskOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!paymentTaskDueDate || paymentTaskMutation.isPending}
            onClick={() => paymentTaskMutation.mutate()}
          >
            Genera
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
