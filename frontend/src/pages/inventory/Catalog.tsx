import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

interface CategoryRow {
  id: string;
  name: string;
}

interface SupplierOption {
  id: string;
  name: string;
}

interface ProductRow {
  id: string;
  name: string;
  unit: string;
  standardQty: number;
  reorderAt?: number;
  supplierCode?: string;
  categoryId: string;
  supplierId: string;
  active: boolean;
  category: { name: string };
  supplier: { name: string };
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

const emptyProductForm = {
  name: '',
  unit: '',
  standardQty: '',
  reorderAt: '',
  supplierCode: '',
  categoryId: '',
  supplierId: '',
};

/** Anagrafica categorie e prodotti: base del calcolo automatico degli ordini. */
export function Catalog() {
  const queryClient = useQueryClient();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [productError, setProductError] = useState<string | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['inventory-categories'],
    queryFn: async () => (await api.get<CategoryRow[]>('/inventory/categories')).data,
  });

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<SupplierOption[]>('/inventory/suppliers')).data,
  });

  const productsQuery = useQuery({
    queryKey: ['inventory-products'],
    queryFn: async () =>
      (await api.get<ProductRow[]>('/inventory/products', { params: { includeInactive: true } }))
        .data,
  });

  const createCategoryMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/inventory/categories', { name: newCategoryName.trim() })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-categories'] });
      setNewCategoryName('');
      setCategoryError(null);
    },
    onError: (err) => setCategoryError(extractErrorMessage(err)),
  });

  const createProductMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/inventory/products', {
          name: productForm.name.trim(),
          unit: productForm.unit.trim(),
          standardQty: Number(productForm.standardQty),
          reorderAt: productForm.reorderAt ? Number(productForm.reorderAt) : undefined,
          supplierCode: productForm.supplierCode.trim() || undefined,
          categoryId: productForm.categoryId,
          supplierId: productForm.supplierId,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-products'] });
      setProductForm(emptyProductForm);
      setProductError(null);
    },
    onError: (err) => setProductError(extractErrorMessage(err)),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch(`/inventory/products/${id}`, { active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-products'] }),
  });

  const canSubmitProduct =
    productForm.name.trim() !== '' &&
    productForm.unit.trim() !== '' &&
    productForm.standardQty !== '' &&
    !!productForm.categoryId &&
    !!productForm.supplierId;

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Nuova categoria
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Nome categoria"
              size="small"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
            />
            <Button
              variant="contained"
              disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
              onClick={() => createCategoryMutation.mutate()}
            >
              Aggiungi
            </Button>
          </Box>
          {categoryError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setCategoryError(null)}>
              {categoryError}
            </Alert>
          )}
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 2 }}>
            {categoriesQuery.data?.map((c) => (
              <Typography key={c.id} variant="body2" sx={{ px: 1.5, py: 0.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                {c.name}
              </Typography>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Nuovo prodotto
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr 1fr' } }}>
            <TextField
              label="Nome prodotto"
              value={productForm.name}
              onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
            />
            <TextField
              label="Unità (pz, kg, cartone...)"
              value={productForm.unit}
              onChange={(e) => setProductForm((f) => ({ ...f, unit: e.target.value }))}
            />
            <TextField
              label="Scorta standard"
              type="number"
              value={productForm.standardQty}
              onChange={(e) => setProductForm((f) => ({ ...f, standardQty: e.target.value }))}
            />
            <TextField
              select
              label="Categoria"
              value={productForm.categoryId}
              onChange={(e) => setProductForm((f) => ({ ...f, categoryId: e.target.value }))}
            >
              {categoriesQuery.data?.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Fornitore"
              value={productForm.supplierId}
              onChange={(e) => setProductForm((f) => ({ ...f, supplierId: e.target.value }))}
            >
              {suppliersQuery.data?.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Soglia minima (opzionale)"
              type="number"
              value={productForm.reorderAt}
              onChange={(e) => setProductForm((f) => ({ ...f, reorderAt: e.target.value }))}
            />
            <TextField
              label="Codice fornitore (opzionale)"
              value={productForm.supplierCode}
              onChange={(e) => setProductForm((f) => ({ ...f, supplierCode: e.target.value }))}
            />
          </Box>
          {productError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setProductError(null)}>
              {productError}
            </Alert>
          )}
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={!canSubmitProduct || createProductMutation.isPending}
            onClick={() => createProductMutation.mutate()}
          >
            Aggiungi
          </Button>
        </CardContent>
      </Card>

      <Typography variant="h6">Prodotti</Typography>
      <Stack spacing={1}>
        {productsQuery.data?.map((product) => (
          <Card key={product.id} variant="outlined">
            <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {product.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {product.category.name} — {product.supplier.name} — standard {product.standardQty}{' '}
                  {product.unit}
                </Typography>
              </Box>
              <Switch
                checked={product.active}
                title="Attivo/disattivo"
                onChange={(e) =>
                  toggleActiveMutation.mutate({ id: product.id, active: e.target.checked })
                }
              />
            </CardContent>
          </Card>
        ))}
        {productsQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessun prodotto censito.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
