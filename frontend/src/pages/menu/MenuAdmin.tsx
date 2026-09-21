import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Chip,
  MenuItem as MuiMenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  IconButton,
} from '@mui/material';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api } from '../../api/client';
import { PhotoCropDialog } from '../../components/PhotoCropDialog';

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
  const [newCategoryName, setNewCategoryName] = useState('');
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

  const createCategoryMutation = useMutation({
    mutationFn: async () => (await api.post('/menu/categories', { name: newCategoryName })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-categories'] });
      setNewCategoryName('');
    },
  });

  const moveCategoryMutation = useMutation({
    mutationFn: async ({ id, direction }: { id: string; direction: 'up' | 'down' }) =>
      (await api.patch(`/menu/categories/${id}/move`, { direction })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu-categories'] }),
  });

  const createItemMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/menu/items', {
          ...newItem,
          price: Number(newItem.price),
        })
      ).data,
    onSuccess: () => {
      invalidate();
      setNewItem({ name: '', price: '', categoryId: '', description: '', availability: 'ALL_DAY' });
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
              disabled={!newCategoryName || createCategoryMutation.isPending}
              onClick={() => createCategoryMutation.mutate()}
            >
              Aggiungi
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
                </Stack>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Nuova voce di menù
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
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
          </Box>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={
              !newItem.name || !newItem.price || !newItem.categoryId || createItemMutation.isPending
            }
            onClick={() => createItemMutation.mutate()}
          >
            Aggiungi al menù
          </Button>
        </CardContent>
      </Card>

      <Typography variant="h6">Voci di menù</Typography>
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
                  </Stack>
                </Box>
              </CardContent>
            </Box>
          </Card>
        ))}
      </Stack>

      <PhotoCropDialog
        open={!!cropImageSrc}
        imageSrc={cropImageSrc}
        onCancel={cancelPhotoCrop}
        onConfirm={confirmPhotoCrop}
      />
    </Box>
  );
}
