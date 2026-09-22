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
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';

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
  costPerUnit?: number;
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
  costPerUnit: '',
  categoryId: '',
  supplierId: '',
};

/** Anagrafica categorie e prodotti: base del calcolo automatico degli ordini. */
export function Catalog() {
  const queryClient = useQueryClient();
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryRow | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<CategoryRow | null>(null);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [productError, setProductError] = useState<string | null>(null);
  const [productToDelete, setProductToDelete] = useState<ProductRow | null>(null);

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

  const saveCategoryMutation = useMutation({
    mutationFn: async () =>
      editingCategory
        ? (
            await api.patch(`/inventory/categories/${editingCategory.id}`, {
              name: newCategoryName.trim(),
            })
          ).data
        : (await api.post('/inventory/categories', { name: newCategoryName.trim() })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-categories'] });
      setNewCategoryName('');
      setCategoryError(null);
      setCategoryDialogOpen(false);
      setEditingCategory(null);
    },
    onError: (err) => setCategoryError(extractErrorMessage(err)),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/inventory/categories/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-categories'] });
      setCategoryToDelete(null);
    },
  });

  const saveProductMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: productForm.name.trim(),
        unit: productForm.unit.trim(),
        standardQty: Number(productForm.standardQty),
        reorderAt: productForm.reorderAt ? Number(productForm.reorderAt) : undefined,
        supplierCode: productForm.supplierCode.trim() || undefined,
        costPerUnit: productForm.costPerUnit ? Number(productForm.costPerUnit) : undefined,
        categoryId: productForm.categoryId,
        supplierId: productForm.supplierId,
      };
      return editingProduct
        ? (await api.patch(`/inventory/products/${editingProduct.id}`, payload)).data
        : (await api.post('/inventory/products', payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-products'] });
      setProductForm(emptyProductForm);
      setProductError(null);
      setProductDialogOpen(false);
      setEditingProduct(null);
    },
    onError: (err) => setProductError(extractErrorMessage(err)),
  });

  const deleteProductMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch(`/inventory/products/${id}`, { active })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-products'] });
      setProductToDelete(null);
    },
  });

  const canSubmitProduct =
    productForm.name.trim() !== '' &&
    productForm.unit.trim() !== '' &&
    productForm.standardQty !== '' &&
    !!productForm.categoryId &&
    !!productForm.supplierId;

  const openCategoryDialog = () => {
    setEditingCategory(null);
    setNewCategoryName('');
    setCategoryError(null);
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (category: CategoryRow) => {
    setEditingCategory(category);
    setNewCategoryName(category.name);
    setCategoryError(null);
    setCategoryDialogOpen(true);
  };

  const openProductDialog = () => {
    setEditingProduct(null);
    setProductForm(emptyProductForm);
    setProductError(null);
    setProductDialogOpen(true);
  };

  const openEditProduct = (product: ProductRow) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      unit: product.unit,
      standardQty: String(product.standardQty),
      reorderAt: product.reorderAt != null ? String(product.reorderAt) : '',
      supplierCode: product.supplierCode ?? '',
      costPerUnit: product.costPerUnit != null ? String(product.costPerUnit) : '',
      categoryId: product.categoryId,
      supplierId: product.supplierId,
    });
    setProductError(null);
    setProductDialogOpen(true);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Categorie</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCategoryDialog}>
              Aggiungi categoria
            </Button>
          </Box>
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 2 }}>
            {categoriesQuery.data?.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                onClick={() => openEditCategory(c)}
                onDelete={() => setCategoryToDelete(c)}
              />
            ))}
            {categoriesQuery.data?.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Nessuna categoria censita.
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Prodotti</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openProductDialog}>
          Aggiungi prodotto
        </Button>
      </Box>
      <Stack spacing={1}>
        {productsQuery.data?.map((product) => (
          <Card key={product.id} variant="outlined">
            <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {product.name}
                  {!product.active && (
                    <Chip size="small" label="Disattivato" sx={{ ml: 1 }} />
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {product.category.name} — {product.supplier.name} — standard {product.standardQty}{' '}
                  {product.unit}
                  {product.costPerUnit != null && ` — € ${product.costPerUnit.toFixed(2)}/${product.unit}`}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5}>
                <IconButton size="small" title="Modifica" onClick={() => openEditProduct(product)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                {product.active ? (
                  <IconButton size="small" title="Elimina" onClick={() => setProductToDelete(product)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                ) : (
                  <IconButton
                    size="small"
                    title="Riattiva"
                    onClick={() => deleteProductMutation.mutate({ id: product.id, active: true })}
                  >
                    <RestartAltIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            </CardContent>
          </Card>
        ))}
        {productsQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessun prodotto censito.
          </Typography>
        )}
      </Stack>

      <Dialog open={categoryDialogOpen} onClose={() => setCategoryDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingCategory ? 'Modifica categoria' : 'Nuova categoria'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 2 }}>
          <TextField
            label="Nome categoria"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />
          {categoryError && <Alert severity="error">{categoryError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setCategoryDialogOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!newCategoryName.trim() || saveCategoryMutation.isPending}
            onClick={() => saveCategoryMutation.mutate()}
          >
            {editingCategory ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!categoryToDelete}
        title="Eliminare la categoria?"
        message={
          categoryToDelete
            ? `"${categoryToDelete.name}" non sarà più selezionabile per nuovi prodotti. I prodotti già assegnati e lo storico ordini restano invariati.`
            : ''
        }
        loading={deleteCategoryMutation.isPending}
        onCancel={() => setCategoryToDelete(null)}
        onConfirm={() => categoryToDelete && deleteCategoryMutation.mutate(categoryToDelete.id)}
      />

      <Dialog open={productDialogOpen} onClose={() => setProductDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingProduct ? 'Modifica prodotto' : 'Nuovo prodotto'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 2 }}>
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
          <TextField
            label="Costo unitario € (opzionale)"
            type="number"
            value={productForm.costPerUnit}
            onChange={(e) => setProductForm((f) => ({ ...f, costPerUnit: e.target.value }))}
            helperText="Usato per il totale quando si stampa l'ordine"
          />
          {productError && (
            <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>
              {productError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setProductDialogOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!canSubmitProduct || saveProductMutation.isPending}
            onClick={() => saveProductMutation.mutate()}
          >
            {editingProduct ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!productToDelete}
        title="Eliminare il prodotto?"
        message={
          productToDelete
            ? `"${productToDelete.name}" non sarà più selezionabile per nuovi ordini. Lo storico ordini resta invariato e potrai riattivarlo in qualsiasi momento.`
            : ''
        }
        loading={deleteProductMutation.isPending}
        onCancel={() => setProductToDelete(null)}
        onConfirm={() =>
          productToDelete && deleteProductMutation.mutate({ id: productToDelete.id, active: false })
        }
      />
    </Box>
  );
}
