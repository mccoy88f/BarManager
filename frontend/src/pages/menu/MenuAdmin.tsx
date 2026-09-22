import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem as MuiMenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api } from '../../api/client';
import { PhotoCropDialog } from '../../components/PhotoCropDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface MenuCategory {
  id: string;
  name: string;
  visible: boolean;
}
interface MenuItemVariant {
  id: string;
  name: string;
  price: number;
}
interface MenuItemRow {
  id: string;
  name: string;
  description?: string;
  variants: MenuItemVariant[];
  photoUrl?: string;
  allergens: string[];
  availability: 'LUNCH' | 'DINNER' | 'ALL_DAY';
  visible: boolean;
  unavailableUntil?: string;
  categoryId: string;
}

interface VariantForm {
  name: string;
  price: string;
}

const emptyVariant: VariantForm = { name: '', price: '' };

/** "€ 3.50" con una sola riga, "da € 3.50" quando ce ne sono più. */
function formatPriceLabel(variants: MenuItemVariant[]): string {
  if (variants.length === 0) return '';
  if (variants.length === 1) return `€ ${variants[0].price.toFixed(2)}`;
  const min = Math.min(...variants.map((v) => v.price));
  return `da € ${min.toFixed(2)}`;
}

const availabilityLabels: Record<string, string> = {
  LUNCH: 'Solo pranzo',
  DINNER: 'Solo cena',
  ALL_DAY: 'Tutto il giorno',
};

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante l\'eliminazione.';
}

const allergenLabels: Record<string, string> = {
  GLUTEN: 'Glutine',
  CRUSTACEANS: 'Crostacei',
  EGGS: 'Uova',
  FISH: 'Pesce',
  PEANUTS: 'Arachidi',
  SOYBEANS: 'Soia',
  MILK: 'Latte',
  NUTS: 'Frutta a guscio',
  CELERY: 'Sedano',
  MUSTARD: 'Senape',
  SESAME: 'Sesamo',
  SULPHITES: 'Solfiti',
  LUPIN: 'Lupini',
  MOLLUSCS: 'Molluschi',
};

function SortableCategoryRow({
  category,
  index,
  locked,
  onEdit,
  onDeleteRequest,
  onToggleVisible,
}: {
  category: MenuCategory;
  index: number;
  locked: boolean;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onToggleVisible: (visible: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  });

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        bgcolor: 'background.paper',
        opacity: isDragging ? 0.5 : 1,
        borderRadius: 1,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <IconButton size="small" {...attributes} {...listeners} sx={{ cursor: 'grab', touchAction: 'none' }}>
          <DragIndicatorIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 20 }}>
          {index + 1}.
        </Typography>
        <Typography variant="body2">{category.name}</Typography>
      </Stack>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Switch
          size="small"
          checked={category.visible}
          onChange={(e) => onToggleVisible(e.target.checked)}
          title="Mostra/nascondi dal menù"
        />
        {!locked && (
          <>
            <IconButton size="small" title="Modifica" onClick={onEdit}>
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" title="Elimina" onClick={onDeleteRequest}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </>
        )}
      </Stack>
    </Box>
  );
}

export function MenuAdmin() {
  const queryClient = useQueryClient();
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryToDelete, setCategoryToDelete] = useState<MenuCategory | null>(null);
  const [categoryDeleteError, setCategoryDeleteError] = useState<string | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItemRow | null>(null);
  const [itemToDelete, setItemToDelete] = useState<MenuItemRow | null>(null);
  const [newItem, setNewItem] = useState({
    name: '',
    categoryId: '',
    description: '',
    availability: 'ALL_DAY',
  });
  const [variantForms, setVariantForms] = useState<VariantForm[]>([emptyVariant]);

  const categoriesQuery = useQuery({
    queryKey: ['menu-categories'],
    queryFn: async () => (await api.get<MenuCategory[]>('/menu/categories')).data,
  });

  const itemsQuery = useQuery({
    queryKey: ['menu-items'],
    queryFn: async () => (await api.get<MenuItemRow[]>('/menu/items')).data,
  });

  const loyverseStatusQuery = useQuery({
    queryKey: ['loyverse-status'],
    queryFn: async () => (await api.get<{ enabled: boolean }>('/loyverse/status')).data,
  });
  const locked = loyverseStatusQuery.data?.enabled === true;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['menu-items'] });

  const saveCategoryMutation = useMutation({
    mutationFn: async () =>
      editingCategory
        ? (await api.patch(`/menu/categories/${editingCategory.id}`, { name: newCategoryName })).data
        : (await api.post('/menu/categories', { name: newCategoryName })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-categories'] });
      setNewCategoryName('');
      setCategoryDialogOpen(false);
      setEditingCategory(null);
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/menu/categories/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-categories'] });
      setCategoryToDelete(null);
      setCategoryDeleteError(null);
    },
    onError: (err) => setCategoryDeleteError(extractErrorMessage(err)),
  });

  const reorderCategoriesMutation = useMutation({
    mutationFn: async (categoryIds: string[]) =>
      (await api.patch('/menu/categories/reorder', { categoryIds })).data,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
  });

  const setCategoryVisibilityMutation = useMutation({
    mutationFn: async ({ id, visible }: { id: string; visible: boolean }) =>
      (await api.patch(`/menu/categories/${id}/visibility`, { visible })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
  });

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const handleCategoryDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !categoriesQuery.data) return;
    const ids = categoriesQuery.data.map((c) => c.id);
    const newIds = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    queryClient.setQueryData<MenuCategory[]>(['menu-categories'], (old) =>
      old ? newIds.map((id) => old.find((c) => c.id === id)!) : old,
    );
    reorderCategoriesMutation.mutate(newIds);
  };

  const saveItemMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...newItem,
        variants: variantForms.map((v) => ({ name: v.name.trim(), price: Number(v.price) })),
      };
      return editingItem
        ? (await api.patch(`/menu/items/${editingItem.id}`, payload)).data
        : (await api.post('/menu/items', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      setNewItem({ name: '', categoryId: '', description: '', availability: 'ALL_DAY' });
      setVariantForms([emptyVariant]);
      setItemDialogOpen(false);
      setEditingItem(null);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/menu/items/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setItemToDelete(null);
    },
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: async ({ id, visible }: { id: string; visible: boolean }) =>
      (await api.patch(`/menu/items/${id}/visibility`, { visible })).data,
    onSuccess: invalidate,
  });

  const setUnavailableMutation = useMutation({
    mutationFn: async ({ id, until }: { id: string; until: string | null }) =>
      (await api.patch(`/menu/items/${id}/unavailable`, { until })).data,
    onSuccess: invalidate,
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append('photo', file);
      return (await api.post(`/menu/items/${id}/photo`, form)).data;
    },
    onSuccess: invalidate,
  });

  const [cropTargetItemId, setCropTargetItemId] = useState<string | null>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  const startPhotoCrop = (itemId: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setCropTargetItemId(itemId);
      setCropImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const cancelPhotoCrop = () => {
    setCropTargetItemId(null);
    setCropImageSrc(null);
  };

  const confirmPhotoCrop = (blob: Blob) => {
    if (!cropTargetItemId) return;
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    uploadPhotoMutation.mutate({ id: cropTargetItemId, file });
    cancelPhotoCrop();
  };

  const openCategoryDialog = () => {
    setEditingCategory(null);
    setNewCategoryName('');
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (category: MenuCategory) => {
    setEditingCategory(category);
    setNewCategoryName(category.name);
    setCategoryDialogOpen(true);
  };

  const openItemDialog = () => {
    setEditingItem(null);
    setNewItem({ name: '', categoryId: '', description: '', availability: 'ALL_DAY' });
    setVariantForms([emptyVariant]);
    setItemDialogOpen(true);
  };

  const openEditItem = (item: MenuItemRow) => {
    setEditingItem(item);
    setNewItem({
      name: item.name,
      categoryId: item.categoryId,
      description: item.description ?? '',
      availability: item.availability,
    });
    setVariantForms(
      item.variants.length > 0
        ? item.variants.map((v) => ({ name: v.name, price: String(v.price) }))
        : [emptyVariant],
    );
    setItemDialogOpen(true);
  };

  const addVariantForm = () => setVariantForms((rows) => [...rows, emptyVariant]);
  const removeVariantForm = (index: number) =>
    setVariantForms((rows) => rows.filter((_, i) => i !== index));
  const updateVariantForm = (index: number, patch: Partial<VariantForm>) =>
    setVariantForms((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const canSubmitItem =
    !!newItem.name &&
    !!newItem.categoryId &&
    variantForms.length > 0 &&
    variantForms.every((v) => v.price.trim() !== '' && Number(v.price) >= 0);

  const publicMenuUrl = `${window.location.origin}/menu`;
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');

  useEffect(() => {
    QRCode.toDataURL(publicMenuUrl, { width: 320, margin: 1 })
      .then(setQrCodeDataUrl)
      .catch(() => setQrCodeDataUrl(''));
  }, [publicMenuUrl]);

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Menù pubblico
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            I clienti possono vedere il menù, senza login, a questo indirizzo o scansionando il
            QR code:
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems="center">
            <Stack spacing={1} sx={{ flexGrow: 1, width: '100%' }}>
              <TextField
                label="URL menù pubblico"
                value={publicMenuUrl}
                size="small"
                InputProps={{ readOnly: true }}
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outlined"
                size="small"
                sx={{ alignSelf: 'flex-start' }}
                onClick={() => navigator.clipboard?.writeText(publicMenuUrl)}
              >
                Copia link
              </Button>
            </Stack>
            {qrCodeDataUrl && (
              <Stack spacing={1} alignItems="center">
                <Box
                  component="img"
                  src={qrCodeDataUrl}
                  alt="QR code menù pubblico"
                  sx={{ width: 160, height: 160 }}
                />
                <Button
                  variant="contained"
                  size="small"
                  component="a"
                  href={qrCodeDataUrl}
                  download="menu-qrcode.png"
                >
                  Scarica QR code
                </Button>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>

      {locked && (
        <Alert severity="info">
          Il menù è sincronizzato da Loyverse: categorie, prodotti e prezzi si gestiscono da lì.
          Qui puoi ancora decidere cosa mostrare online (visibilità, disponibilità, foto) — per
          disattivare la sincronizzazione vai in Impostazioni locale.
        </Alert>
      )}

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Categorie</Typography>
            {!locked && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCategoryDialog}>
                Aggiungi categoria
              </Button>
            )}
          </Box>

          <Typography variant="caption" color="text.secondary">
            Trascina per riordinare come compaiono nel menù pubblico.
          </Typography>
          <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
            <SortableContext
              items={categoriesQuery.data?.map((c) => c.id) ?? []}
              strategy={verticalListSortingStrategy}
            >
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {categoriesQuery.data?.map((category, index) => (
                  <SortableCategoryRow
                    key={category.id}
                    category={category}
                    index={index}
                    locked={locked}
                    onEdit={() => openEditCategory(category)}
                    onDeleteRequest={() => {
                      setCategoryDeleteError(null);
                      setCategoryToDelete(category);
                    }}
                    onToggleVisible={(visible) =>
                      setCategoryVisibilityMutation.mutate({ id: category.id, visible })
                    }
                  />
                ))}
              </Stack>
            </SortableContext>
          </DndContext>
        </CardContent>
      </Card>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Voci di menù</Typography>
        {!locked && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openItemDialog}>
            Aggiungi al menù
          </Button>
        )}
      </Box>
      <Stack spacing={2}>
        {itemsQuery.data?.map((item) => (
          <Card key={item.id} variant="outlined">
            <Box sx={{ display: 'flex' }}>
              {item.photoUrl && (
                <CardMedia
                  component="img"
                  image={item.photoUrl}
                  alt={item.name}
                  sx={{ width: 100, height: 100, objectFit: 'cover' }}
                />
              )}
              <CardContent sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <Typography variant="subtitle1" fontWeight={600}>
                      {item.name} — {formatPriceLabel(item.variants)}
                    </Typography>
                    {item.variants.length > 1 && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {item.variants.map((v) => `${v.name || 'Standard'}: € ${v.price.toFixed(2)}`).join(' · ')}
                      </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary">
                      {item.description}
                    </Typography>
                    <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      <Chip size="small" label={availabilityLabels[item.availability]} />
                      {item.allergens.map((a) => (
                        <Chip key={a} size="small" variant="outlined" label={allergenLabels[a] ?? a} />
                      ))}
                      {item.unavailableUntil && new Date(item.unavailableUntil) > new Date() && (
                        <Chip size="small" color="warning" label="Temporaneamente non disponibile" />
                      )}
                    </Box>
                  </div>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <IconButton component="label" size="small" title="Carica foto">
                      <PhotoCameraIcon fontSize="small" />
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) startPhotoCrop(item.id, file);
                          e.target.value = '';
                        }}
                      />
                    </IconButton>
                    {(() => {
                      const isUnavailable =
                        !!item.unavailableUntil && new Date(item.unavailableUntil) > new Date();
                      return (
                        <IconButton
                          size="small"
                          color={isUnavailable ? 'warning' : 'default'}
                          title={
                            isUnavailable
                              ? 'Rendi di nuovo disponibile'
                              : 'Segna temporaneamente non disponibile (2 ore)'
                          }
                          onClick={() =>
                            setUnavailableMutation.mutate({
                              id: item.id,
                              until: isUnavailable
                                ? null
                                : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
                            })
                          }
                        >
                          {isUnavailable ? (
                            <EventAvailableIcon fontSize="small" />
                          ) : (
                            <EventBusyIcon fontSize="small" />
                          )}
                        </IconButton>
                      );
                    })()}
                    <Switch
                      checked={item.visible}
                      onChange={(e) =>
                        toggleVisibilityMutation.mutate({ id: item.id, visible: e.target.checked })
                      }
                      title="Mostra/nascondi dal menù"
                    />
                    {!locked && (
                      <>
                        <IconButton size="small" title="Modifica" onClick={() => openEditItem(item)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" title="Elimina" onClick={() => setItemToDelete(item)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </Stack>
                </Box>
              </CardContent>
            </Box>
          </Card>
        ))}
      </Stack>

      <Dialog open={categoryDialogOpen} onClose={() => setCategoryDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingCategory ? 'Modifica categoria' : 'Nuova categoria'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            label="Nome categoria"
            fullWidth
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setCategoryDialogOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!newCategoryName || saveCategoryMutation.isPending}
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
          categoryDeleteError ??
          (categoryToDelete
            ? `"${categoryToDelete.name}" verrà eliminata definitivamente. Possibile solo se non contiene più voci di menù.`
            : '')
        }
        loading={deleteCategoryMutation.isPending}
        onCancel={() => {
          setCategoryToDelete(null);
          setCategoryDeleteError(null);
        }}
        onConfirm={() => categoryToDelete && deleteCategoryMutation.mutate(categoryToDelete.id)}
      />

      <Dialog open={itemDialogOpen} onClose={() => setItemDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingItem ? 'Modifica voce di menù' : 'Nuova voce di menù'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, pt: 2 }}>
          <TextField
            label="Nome piatto"
            value={newItem.name}
            onChange={(e) => setNewItem((v) => ({ ...v, name: e.target.value }))}
          />
          <TextField
            select
            label="Categoria"
            value={newItem.categoryId}
            onChange={(e) => setNewItem((v) => ({ ...v, categoryId: e.target.value }))}
          >
            {categoriesQuery.data?.map((c) => (
              <MuiMenuItem key={c.id} value={c.id}>
                {c.name}
              </MuiMenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Disponibilità oraria"
            InputLabelProps={{ shrink: true }}
            value={newItem.availability}
            onChange={(e) => setNewItem((v) => ({ ...v, availability: e.target.value }))}
          >
            {Object.entries(availabilityLabels).map(([value, label]) => (
              <MuiMenuItem key={value} value={value}>
                {label}
              </MuiMenuItem>
            ))}
          </TextField>
          <TextField
            label="Descrizione"
            multiline
            minRows={2}
            value={newItem.description}
            onChange={(e) => setNewItem((v) => ({ ...v, description: e.target.value }))}
            sx={{ gridColumn: '1 / -1' }}
          />

          <Box sx={{ gridColumn: '1 / -1' }}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
              Prezzo
            </Typography>
            <Stack spacing={1}>
              {variantForms.map((variant, index) => (
                <Stack key={index} direction="row" spacing={1} alignItems="center">
                  {variantForms.length > 1 && (
                    <TextField
                      label="Formato (es. Piccola)"
                      size="small"
                      value={variant.name}
                      onChange={(e) => updateVariantForm(index, { name: e.target.value })}
                      sx={{ flex: 1 }}
                    />
                  )}
                  <TextField
                    label="Prezzo (€)"
                    type="number"
                    size="small"
                    value={variant.price}
                    onChange={(e) => updateVariantForm(index, { price: e.target.value })}
                    sx={{ width: variantForms.length > 1 ? 120 : '100%' }}
                  />
                  {variantForms.length > 1 && (
                    <IconButton size="small" title="Rimuovi formato" onClick={() => removeVariantForm(index)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              ))}
            </Stack>
            <Button size="small" startIcon={<AddIcon />} sx={{ mt: 1 }} onClick={addVariantForm}>
              Aggiungi formato (es. piccola/grande)
            </Button>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setItemDialogOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!canSubmitItem || saveItemMutation.isPending}
            onClick={() => saveItemMutation.mutate()}
          >
            {editingItem ? 'Salva' : 'Aggiungi al menù'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!itemToDelete}
        title="Eliminare la voce di menù?"
        message={itemToDelete ? `"${itemToDelete.name}" verrà eliminata definitivamente.` : ''}
        loading={deleteItemMutation.isPending}
        onCancel={() => setItemToDelete(null)}
        onConfirm={() => itemToDelete && deleteItemMutation.mutate(itemToDelete.id)}
      />

      <PhotoCropDialog
        open={!!cropImageSrc}
        imageSrc={cropImageSrc}
        onCancel={cancelPhotoCrop}
        onConfirm={confirmPhotoCrop}
      />
    </Box>
  );
}
