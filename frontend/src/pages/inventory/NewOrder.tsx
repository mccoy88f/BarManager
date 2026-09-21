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
  TableHead,
  TableRow,
  Alert,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

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
  category: { name: string };
}

/**
 * Flusso "nuovo ordine": si sceglie il fornitore, si inserisce la giacenza
 * per ciascun prodotto e il sistema calcola la quantità da ordinare
 * (standardQty - giacenza, mai negativa). L'utente può correggerla prima
 * dell'invio (email + stampa checklist).
 */
export function NewOrder() {
  const [searchParams] = useSearchParams();
  const [supplierId, setSupplierId] = useState(searchParams.get('supplierId') ?? '');
  const [stock, setStock] = useState<Record<string, string>>({});
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);

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
    onSuccess: (data) => setCreatedOrderId(data.id),
  });

  const sendMutation = useMutation({
    mutationFn: async () => (await api.post(`/inventory/orders/${createdOrderId}/send`)).data,
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
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Prodotto</TableCell>
                  <TableCell>Standard</TableCell>
                  <TableCell>Giacenza</TableCell>
                  <TableCell>Da ordinare</TableCell>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>

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
                  Bozza creata. Verifica le quantità e conferma l'invio.
                </Alert>
                <Button
                  variant="contained"
                  color="secondary"
                  disabled={sendMutation.isPending}
                  onClick={() => sendMutation.mutate()}
                >
                  Invia ordine (email + stampa)
                </Button>
                {sendMutation.isSuccess && (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    Ordine inviato.
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
