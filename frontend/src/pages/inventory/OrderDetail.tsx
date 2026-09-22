import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import PrintIcon from '@mui/icons-material/Print';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { deliverPrintJob, type PrintJobResponse } from '../../printing/qzPrint';

interface OrderLineRow {
  id: string;
  orderedQty: number;
  product: { name: string; unit: string; costPerUnit?: number };
}

interface OrderRow {
  id: string;
  status: 'DRAFT' | 'SENT' | 'CONFIRMED' | 'CLOSED';
  createdAt: string;
  sentAt?: string;
  supplier: { name: string };
  createdBy: { email: string };
  lines: OrderLineRow[];
}

const statusLabels: Record<OrderRow['status'], string> = {
  DRAFT: 'Bozza',
  SENT: 'Inviato',
  CONFIRMED: 'Confermato',
  CLOSED: 'Chiuso',
};

const statusColor: Record<OrderRow['status'], 'default' | 'warning' | 'success'> = {
  DRAFT: 'default',
  SENT: 'warning',
  CONFIRMED: 'success',
  CLOSED: 'default',
};

const printFailureLabels: Record<string, string> = {
  NO_PRINTER_CONFIGURED: 'Nessuna stampante configurata per gli ordini (Impostazioni > Stampanti).',
  QZ_ERROR:
    'Impossibile stampare: verifica che QZ Tray sia installato e in esecuzione su questo dispositivo (https://qz.io/download/), e che la stampante sia raggiungibile dalla rete locale.',
};

function orderTotal(order: OrderRow): number {
  return order.lines.reduce((sum, l) => sum + (l.product.costPerUnit ?? 0) * l.orderedQty, 0);
}

/** Dettaglio di un ordine dello storico, come pagina propria (non un modale). */
export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [printResult, setPrintResult] = useState<{ printed: boolean; reason?: string } | null>(null);

  const orderQuery = useQuery({
    queryKey: ['order', id],
    queryFn: async () => (await api.get<OrderRow>(`/inventory/orders/${id}`)).data,
  });

  const printMutation = useMutation({
    mutationFn: async () => {
      const job = (await api.post<PrintJobResponse>(`/inventory/orders/${id}/print`)).data;
      return deliverPrintJob(job);
    },
    onSuccess: setPrintResult,
    onError: () => setPrintResult({ printed: false }),
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
        <Chip color={statusColor[order.status]} label={statusLabels[order.status]} />
      </Stack>

      <Stack direction="row" spacing={1}>
        <Button variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={downloadPdf}>
          Esporta PDF
        </Button>
        <Button
          variant="outlined"
          startIcon={<PrintIcon />}
          disabled={printMutation.isPending}
          onClick={() => printMutation.mutate()}
        >
          Ristampa su stampante POS
        </Button>
      </Stack>

      {printResult && (
        <Alert severity={printResult.printed ? 'success' : 'warning'} onClose={() => setPrintResult(null)}>
          {printResult.printed
            ? 'Ristampa inviata alla stampante.'
            : (printResult.reason && printFailureLabels[printResult.reason]) || 'Ristampa non riuscita.'}
        </Alert>
      )}

      <Card variant="outlined">
        <CardContent>
          <TableContainer>
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
    </Box>
  );
}
