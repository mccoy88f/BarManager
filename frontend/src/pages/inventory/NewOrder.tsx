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
  ToggleButton,
  ToggleButtonGroup,
  Stack,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { shareReceiptPdf } from '../../printing/printJob';
import { useToast } from '../../components/ToastProvider';

interface Supplier {
  id: string;
  name: string;
}
interface Category {
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
  supplier: { name: string };
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
  supplier: { name: string };
}
interface SendBatchResult {
  orderId: string;
  supplierName: string | null;
  sent: boolean;
  error?: string;
}

/**
 * Flusso "nuovo ordine": per fornitore (comportamento storico) o per
 * categoria — in questo caso i prodotti possono appartenere a fornitori
 * diversi, e all'invio il sistema li divide automaticamente in un ordine
 * per fornitore, con email separate e un unico PDF con una pagina per
 * fornitore. In entrambi i casi: giacenza per prodotto, quantità
 * suggerita (standard - giacenza, mai negativa) correggibile prima
 * dell'invio.
 */
export function NewOrder() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<'supplier' | 'category'>('supplier');
  const [supplierId, setSupplierId] = useState(searchParams.get('supplierId') ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [stock, setStock] = useState<Record<string, string>>({});
  const [editedQty, setEditedQty] = useState<Record<string, string>>({});

  // Fornitore: un solo ordine (id). Categoria: un ordine per fornitore coinvolto.
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [createdOrderIds, setCreatedOrderIds] = useState<string[] | null>(null);
  const [sendBatchResults, setSendBatchResults] = useState<SendBatchResult[] | null>(null);

  const selectionId = mode === 'supplier' ? supplierId : categoryId;

  const resetSelection = () => {
    setStock({});
    setCreatedOrderId(null);
    setCreatedOrderIds(null);
    setSendBatchResults(null);
    setEditedQty({});
  };

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<Supplier[]>('/inventory/suppliers')).data,
  });

  const categoriesQuery = useQuery({
    queryKey: ['inventory-categories'],
    queryFn: async () => (await api.get<Category[]>('/inventory/categories')).data,
  });

  const productsQuery = useQuery({
    queryKey: ['products', mode, selectionId],
    queryFn: async () =>
      (
        await api.get<Product[]>('/inventory/products', {
          params: mode === 'supplier' ? { supplierId } : { categoryId },
        })
      ).data,
    enabled: !!selectionId,
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

  const linesPayload = () =>
    suggestions
      .filter((s) => stock[s.product.id] !== undefined)
      .map((s) => ({ productId: s.product.id, stockOnHand: s.stockOnHand }));

  const createMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/inventory/orders', { supplierId, lines: linesPayload() })).data,
    onSuccess: (data) => {
      setCreatedOrderId(data.id);
      setEditedQty({});
    },
  });

  const createByCategoryMutation = useMutation({
    mutationFn: async (): Promise<Order[]> =>
      (await api.post('/inventory/orders/by-category', { categoryId, lines: linesPayload() })).data,
    onSuccess: (orders) => {
      setCreatedOrderIds(orders.map((o) => o.id));
      setEditedQty({});
    },
  });

  const orderQuery = useQuery({
    queryKey: ['order', createdOrderId],
    queryFn: async () => (await api.get<Order>(`/inventory/orders/${createdOrderId}`)).data,
    enabled: !!createdOrderId,
  });

  const ordersBatchQuery = useQuery({
    queryKey: ['orders-batch', createdOrderIds],
    queryFn: async () =>
      Promise.all(
        (createdOrderIds ?? []).map(
          async (id) => (await api.get<Order>(`/inventory/orders/${id}`)).data,
        ),
      ),
    enabled: !!createdOrderIds && createdOrderIds.length > 0,
  });

  const updateLineMutation = useMutation({
    mutationFn: async ({
      orderId,
      lineId,
      orderedQty,
    }: {
      orderId: string;
      lineId: string;
      orderedQty: number;
    }) => (await api.patch(`/inventory/orders/${orderId}/lines/${lineId}`, { orderedQty })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', createdOrderId] });
      queryClient.invalidateQueries({ queryKey: ['orders-batch', createdOrderIds] });
    },
  });

  const saveLineQty = (orderId: string, lineId: string, value: string) => {
    const orderedQty = Number(value);
    if (Number.isNaN(orderedQty) || orderedQty < 0) return;
    updateLineMutation.mutate({ orderId, lineId, orderedQty });
  };

  const orderTotal = (order?: Order) =>
    order?.lines.reduce((sum, l) => sum + (l.product.costPerUnit ?? 0) * l.orderedQty, 0) ?? 0;

  const sendMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/inventory/orders/${createdOrderId}/send`);
      const response = await api.get(`/inventory/orders/${createdOrderId}/export/pdf`, {
        responseType: 'blob',
      });
      await shareReceiptPdf(response.data, `Ordine ${createdOrderId}`);
    },
    onSuccess: () => showToast('Ordine inviato: ricevuta condivisa per la stampa.'),
  });

  const sendBatchMutation = useMutation({
    mutationFn: async (): Promise<SendBatchResult[]> =>
      (
        await api.post('/inventory/orders/send-batch', { orderIds: createdOrderIds })
      ).data,
    onSuccess: setSendBatchResults,
  });

  const downloadBatchPdf = async () => {
    if (!createdOrderIds) return;
    const response = await api.get('/inventory/orders/export/pdf-batch', {
      params: { ids: createdOrderIds.join(',') },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ordini.pdf';
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderLinesTable = (order: Order) => (
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
          {order.lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell>{line.product.name}</TableCell>
              <TableCell>
                <TextField
                  type="number"
                  size="small"
                  value={editedQty[line.id] ?? line.orderedQty}
                  onChange={(e) => setEditedQty((q) => ({ ...q, [line.id]: e.target.value }))}
                  onBlur={(e) => saveLineQty(order.id, line.id, e.target.value)}
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
  );

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography variant="h6">Nuovo ordine</Typography>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={mode}
        onChange={(_e, v) => {
          if (!v) return;
          setMode(v);
          resetSelection();
        }}
        sx={{ justifySelf: 'flex-start' }}
      >
        <ToggleButton value="supplier">Per fornitore</ToggleButton>
        <ToggleButton value="category">Per categoria</ToggleButton>
      </ToggleButtonGroup>

      {mode === 'category' && (
        <Alert severity="info" sx={{ maxWidth: 640 }}>
          I prodotti della categoria scelta verranno divisi automaticamente per fornitore: un
          ordine, un'email e una pagina del PDF per ciascuno.
        </Alert>
      )}

      {mode === 'supplier' ? (
        <TextField
          select
          label="Fornitore"
          value={supplierId}
          onChange={(e) => {
            setSupplierId(e.target.value);
            resetSelection();
          }}
          sx={{ maxWidth: 320 }}
        >
          {suppliersQuery.data?.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <TextField
          select
          label="Categoria"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            resetSelection();
          }}
          sx={{ maxWidth: 320 }}
        >
          {categoriesQuery.data?.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
      )}

      {!!selectionId && (
        <Card>
          <CardContent>
            <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Prodotto</TableCell>
                    {mode === 'category' && <TableCell>Fornitore</TableCell>}
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
                      {mode === 'category' && <TableCell>{product.supplier.name}</TableCell>}
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

            {mode === 'supplier' ? (
              !createdOrderId ? (
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

                  {orderQuery.data && renderLinesTable(orderQuery.data)}

                  {orderTotal(orderQuery.data) > 0 && (
                    <Typography variant="body2" sx={{ mt: 1, textAlign: 'right' }} fontWeight={600}>
                      Totale: € {orderTotal(orderQuery.data).toFixed(2)}
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
                </Box>
              )
            ) : !createdOrderIds ? (
              <Button
                variant="contained"
                sx={{ mt: 2 }}
                disabled={createByCategoryMutation.isPending}
                onClick={() => createByCategoryMutation.mutate()}
              >
                Crea bozze ordine (una per fornitore)
              </Button>
            ) : (
              <Box sx={{ mt: 2 }}>
                <Alert severity="info" sx={{ mb: 2 }}>
                  {ordersBatchQuery.data?.length ?? 0} bozze create, una per fornitore. Correggi le
                  quantità se serve, poi invia tutte insieme.
                </Alert>

                <Stack spacing={2}>
                  {ordersBatchQuery.data?.map((order) => (
                    <Card key={order.id} variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" gutterBottom>
                          {order.supplier.name}
                        </Typography>
                        {renderLinesTable(order)}
                        {orderTotal(order) > 0 && (
                          <Typography
                            variant="body2"
                            sx={{ mt: 1, textAlign: 'right' }}
                            fontWeight={600}
                          >
                            Totale: € {orderTotal(order).toFixed(2)}
                          </Typography>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </Stack>

                <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                  <Button
                    variant="contained"
                    color="secondary"
                    disabled={sendBatchMutation.isPending || updateLineMutation.isPending}
                    onClick={() => sendBatchMutation.mutate()}
                  >
                    Invia tutti gli ordini (email separate)
                  </Button>
                  <Button variant="outlined" onClick={downloadBatchPdf}>
                    Scarica PDF (una pagina per fornitore)
                  </Button>
                </Stack>

                {sendBatchResults && (
                  <Stack spacing={1} sx={{ mt: 2 }}>
                    {sendBatchResults.map((r) => (
                      <Alert key={r.orderId} severity={r.sent ? 'success' : 'error'}>
                        {r.sent
                          ? `Inviato a ${r.supplierName}.`
                          : `Invio non riuscito (ordine ${r.orderId}): ${r.error}`}
                      </Alert>
                    ))}
                  </Stack>
                )}
              </Box>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
