import { useEffect, useState } from 'react';
import {
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
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api } from '../../api/client';
import { PhotoCropDialog } from '../../components/PhotoCropDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface MenuCategory {
  id: string;
  name: string;
}
interface MenuItemRow {
  id: string;
  name: string;
  description?: string;
  price: number;
  photoUrl?: string;
  allergens: string[];
  availability: 'LUNCH' | 'DINNER' | 'ALL_DAY';
  visible: boolean;
  unavailableUntil?: string;
  categoryId: string;
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
    price: '',
    categoryId: '',
    description: '',
    availability: 'ALL_DAY',
  });

  const categoriesQuery = useQuery({
    queryKey: ['menu-categories'],
    queryFn: async () => (await api.get<MenuCategory[]>('/menu/categories')).data,
  });

  const itemsQuery = useQuery({
    queryKey: ['menu-items'],
    queryFn: async () => (await api.get<MenuItemRow[]>('/menu/items')).data,
  });

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

  const moveCategoryMutation = useMutation({
    mutationFn: async ({ id, direction }: { id: string; direction: 'up' | 'down' }) =>
      (await api.patch(`/menu/categories/${id}/move`, { direction })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
  });

  const saveItemMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...newItem, price: Number(newItem.price) };
      return editingItem
        ? (await api.patch(`/menu/items/${editingItem.id}`, payload)).data
        : (await api.post('/menu/items', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      setNewItem({ name: '', price: '', categoryId: '', description: '', availability: 'ALL_DAY' });
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
    setNewItem({ name: '', price: '', categoryId: '', description: '', availability: 'ALL_DAY' });
    setItemDialogOpen(true);
  };

  const openEditItem = (item: MenuItemRow) => {
    setEditingItem(item);
    setNewItem({
      name: item.name,
      price: String(item.price),
      categoryId: item.categoryId,
      description: item.description ?? '',
      availability: item.availability,
    });
    setItemDialogOpen(true);
  };

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

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Categorie</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCategoryDialog}>
              Aggiungi categoria
            </Button>
          </Box>

          <Stack spacing={0.5} sx={{ mt: 2 }}>
            {categoriesQuery.data?.map((category, index) => (
              <Box
                key={category.id}
                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Typography variant="body2">{category.name}</Typography>
                <Stack direction="row">
                  <IconButton
                    size="small"
                    disabled={index === 0 || moveCategoryMutation.isPending}
                    onClick={() => moveCategoryMutation.mutate({ id: category.id, direction: 'up' })}
                  >
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={
                      index === (categoriesQuery.data?.length ?? 0) - 1 ||
                      moveCategoryMutation.isPending
                    }
                    onClick={() =>
                      moveCategoryMutation.mutate({ id: category.id, direction: 'down' })
                    }
                  >
                    <ArrowDownwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" title="Modifica" onClick={() => openEditCategory(category)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    title="Elimina"
                    onClick={() => {
                      setCategoryDeleteError(null);
                      setCategoryToDelete(category);
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Voci di menù</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openItemDialog}>
          Aggiungi al menù
        </Button>
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
                      {item.name} — € {item.price.toFixed(2)}
                    </Typography>
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
                    <IconButton size="small" title="Modifica" onClick={() => openEditItem(item)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" title="Elimina" onClick={() => setItemToDelete(item)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
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
            label="Prezzo (€)"
            type="number"
            value={newItem.price}
            onChange={(e) => setNewItem((v) => ({ ...v, price: e.target.value }))}
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
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setItemDialogOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={
              !newItem.name || !newItem.price || !newItem.categoryId || saveItemMutation.isPending
            }
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
