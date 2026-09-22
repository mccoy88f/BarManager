import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { deliverPrintJob, type PrintJobResponse, type PrintOutcome } from '../../printing/printJob';

interface Supplier {
  id: string;
  name: string;
}
interface Product {
  id: string;
  name: string;
  unit: string;
  standardQty: number;
  supplierId: string;
  costPerUnit?: number;
  category: { name: string };
}
interface OrderLine {
  id: string;
  orderedQty: number;
  suggestedQty: number;
  product: Product;
}
interface Order {
  id: string;
  status: string;
  lines: OrderLine[];
}

/**
 * Flusso "nuovo ordine": si sceglie il fornitore, si inserisce la giacenza
 * per ciascun prodotto e il sistema calcola la quantità da ordinare
 * (standardQty - giacenza, mai negativa). L'utente può correggerla prima
 * dell'invio (email + stampa checklist).
 */
export function NewOrder() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [supplierId, setSupplierId] = useState(searchParams.get('supplierId') ?? '');
  const [stock, setStock] = useState<Record<string, string>>({});
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [editedQty, setEditedQty] = useState<Record<string, string>>({});

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<Supplier[]>('/inventory/suppliers')).data,
  });

  const productsQuery = useQuery({
    queryKey: ['products', supplierId],
    queryFn: async () =>
      (await api.get<Product[]>('/inventory/products', { params: { supplierId } })).data,
    enabled: !!supplierId,
  });

  const suggestions = useMemo(() => {
    if (!productsQuery.data) return [];
    return productsQuery.data.map((p) => {
      const stockOnHand = Number(stock[p.id] ?? 0);
      const suggestedQty = Math.max(0, p.standardQty - stockOnHand);
      return { product: p, stockOnHand, suggestedQty };
    });
  }, [productsQuery.data, stock]);

  const estimatedTotal = suggestions.reduce(
    (sum, s) => sum + (s.product.costPerUnit ?? 0) * s.suggestedQty,
    0,
  );

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/inventory/orders', {
          supplierId,
          lines: suggestions
            .filter((s) => stock[s.product.id] !== undefined)
            .map((s) => ({ productId: s.product.id, stockOnHand: s.stockOnHand })),
        })
      ).data,
    onSuccess: (data) => {
      setCreatedOrderId(data.id);
      setEditedQty({});
    },
  });

  const orderQuery = useQuery({
    queryKey: ['order', createdOrderId],
    queryFn: async () => (await api.get<Order>(`/inventory/orders/${createdOrderId}`)).data,
    enabled: !!createdOrderId,
  });

  const updateLineMutation = useMutation({
    mutationFn: async ({ lineId, orderedQty }: { lineId: string; orderedQty: number }) =>
      (
        await api.patch(`/inventory/orders/${createdOrderId}/lines/${lineId}`, { orderedQty })
      ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order', createdOrderId] }),
  });

  const saveLineQty = (lineId: string, value: string) => {
    const orderedQty = Number(value);
    if (Number.isNaN(orderedQty) || orderedQty < 0) return;
    updateLineMutation.mutate({ lineId, orderedQty });
  };

  const orderTotal =
    orderQuery.data?.lines.reduce(
      (sum, l) => sum + (l.product.costPerUnit ?? 0) * l.orderedQty,
      0,
    ) ?? 0;

  const sendMutation = useMutation({
    mutationFn: async (): Promise<PrintOutcome> => {
      await api.post(`/inventory/orders/${createdOrderId}/send`);
      const job = (await api.post<PrintJobResponse>(`/inventory/orders/${createdOrderId}/print`))
        .data;
      return deliverPrintJob(job);
    },
  });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography variant="h6">Nuovo ordine</Typography>

      <TextField
        select
        label="Fornitore"
        value={supplierId}
        onChange={(e) => {
          setSupplierId(e.target.value);
          setStock({});
          setCreatedOrderId(null);
        }}
        sx={{ maxWidth: 320 }}
      >
        {suppliersQuery.data?.map((s) => (
          <MenuItem key={s.id} value={s.id}>
            {s.name}
          </MenuItem>
        ))}
      </TextField>

      {!!supplierId && (
        <Card>
          <CardContent>
            <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Prodotto</TableCell>
                    <TableCell>Standard</TableCell>
                    <TableCell>Giacenza</TableCell>
                    <TableCell>Da ordinare</TableCell>
                    <TableCell>Costo stimato</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {suggestions.map(({ product, suggestedQty }) => (
                    <TableRow key={product.id}>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>
                        {product.standardQty} {product.unit}
                      </TableCell>
                      <TableCell>
                        <TextField
                          type="number"
                          size="small"
                          value={stock[product.id] ?? ''}
                          onChange={(e) =>
                            setStock((s) => ({ ...s, [product.id]: e.target.value }))
                          }
                          sx={{ width: 90 }}
                        />
                      </TableCell>
                      <TableCell>
                        {suggestedQty} {product.unit}
                      </TableCell>
                      <TableCell>
                        {product.costPerUnit != null
                          ? `€ ${(product.costPerUnit * suggestedQty).toFixed(2)}`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {estimatedTotal > 0 && (
              <Typography variant="body2" sx={{ mt: 1, textAlign: 'right' }} fontWeight={600}>
                Totale stimato: € {estimatedTotal.toFixed(2)}
              </Typography>
            )}

            {!createdOrderId ? (
              <Button
                variant="contained"
                sx={{ mt: 2 }}
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                Crea bozza ordine
              </Button>
            ) : (
              <Box sx={{ mt: 2 }}>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Bozza creata. Correggi le quantità se serve, poi confirma l'invio.
                </Alert>

                <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Prodotto</TableCell>
                        <TableCell>Da ordinare</TableCell>
                        <TableCell>Costo</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {orderQuery.data?.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>{line.product.name}</TableCell>
                          <TableCell>
                            <TextField
                              type="number"
                              size="small"
                              value={editedQty[line.id] ?? line.orderedQty}
                              onChange={(e) =>
                                setEditedQty((q) => ({ ...q, [line.id]: e.target.value }))
                              }
                              onBlur={(e) => saveLineQty(line.id, e.target.value)}
                              sx={{ width: 90 }}
                              InputProps={{ endAdornment: line.product.unit }}
                            />
                          </TableCell>
                          <TableCell>
                            {line.product.costPerUnit != null
                              ? `€ ${(line.product.costPerUnit * line.orderedQty).toFixed(2)}`
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                {orderTotal > 0 && (
                  <Typography variant="body2" sx={{ mt: 1, textAlign: 'right' }} fontWeight={600}>
                    Totale: € {orderTotal.toFixed(2)}
                  </Typography>
                )}

                <Button
                  variant="contained"
                  color="secondary"
                  sx={{ mt: 2 }}
                  disabled={sendMutation.isPending || updateLineMutation.isPending}
                  onClick={() => sendMutation.mutate()}
                >
                  Invia ordine (email + stampa)
                </Button>
                {sendMutation.isSuccess && (
                  <Alert severity={sendMutation.data.printed ? 'success' : 'warning'} sx={{ mt: 2 }}>
                    {sendMutation.data.printed
                      ? 'Ordine inviato: dialogo di stampa aperto.'
                      : 'Ordine inviato (nessuna stampante configurata per gli ordini: Impostazioni > Stampanti).'}
                  </Alert>
                )}
              </Box>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
