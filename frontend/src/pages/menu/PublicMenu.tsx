import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Typography,
  Card,
  CardContent,
  CardMedia,
  Chip,
  Stack,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import StarIcon from '@mui/icons-material/Star';
import PhoneIcon from '@mui/icons-material/Phone';
import InstagramIcon from '@mui/icons-material/Instagram';
import FacebookIcon from '@mui/icons-material/Facebook';
import LanguageIcon from '@mui/icons-material/Language';
import { api } from '../../api/client';
import { ImageLightbox } from '../../components/ImageLightbox';

interface PublicMenuVariant {
  id: string;
  name: string;
  /** null = prezzo variabile (deciso in cassa, o a peso). */
  price: number | null;
}
interface PublicMenuItem {
  id: string;
  name: string;
  description?: string;
  variants: PublicMenuVariant[];
  photoUrl?: string;
  allergens: string[];
  featured: boolean;
  available: boolean;
}
interface PublicMenuCategory {
  id: string;
  name: string;
  items: PublicMenuItem[];
}
interface PublicMenuResponse {
  venue: {
    name: string;
    coverUrl?: string;
    address?: string;
    phone?: string;
    instagramUrl?: string;
    facebookUrl?: string;
    websiteUrl?: string;
  };
  categories: PublicMenuCategory[];
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

function matches(item: PublicMenuItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.name.toLowerCase().includes(q) ||
    (item.description ?? '').toLowerCase().includes(q) ||
    item.variants.some((v) => v.name.toLowerCase().includes(q))
  );
}

/** "€ 3.50" con un solo formato, "da € 3.50" quando ce ne sono più, "Prezzo variabile" senza importi fissi. */
function priceLabel(variants: PublicMenuVariant[]): string {
  if (variants.length === 0) return '';
  if (variants.length === 1) {
    return variants[0].price != null ? `€ ${variants[0].price.toFixed(2)}` : 'Prezzo variabile';
  }
  const priced = variants.filter((v) => v.price != null);
  if (priced.length === 0) return 'Prezzo variabile';
  return `da € ${Math.min(...priced.map((v) => v.price as number)).toFixed(2)}`;
}

function MenuItemCard({
  item,
  onImageClick,
}: {
  item: PublicMenuItem;
  onImageClick: (url: string) => void;
}) {
  return (
    <Card variant="outlined" sx={{ opacity: item.available ? 1 : 0.6 }}>
      <Box sx={{ display: 'flex' }}>
        {item.photoUrl && (
          <CardMedia
            component="img"
            image={item.photoUrl}
            alt={item.name}
            onClick={() => onImageClick(item.photoUrl!)}
            sx={{ width: 96, height: 96, objectFit: 'cover', cursor: 'zoom-in' }}
          />
        )}
        <CardContent sx={{ flex: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="subtitle1" fontWeight={600}>
              {item.name}
            </Typography>
            <Typography variant="subtitle1" fontWeight={600}>
              {priceLabel(item.variants)}
            </Typography>
          </Box>
          {item.description && (
            <Typography variant="body2" color="text.secondary">
              {item.description}
            </Typography>
          )}
          {item.variants.length > 1 && (
            <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {item.variants.map((v) => (
                <Chip
                  key={v.id}
                  size="small"
                  label={`${v.name || 'Standard'}: ${v.price != null ? `€ ${v.price.toFixed(2)}` : 'variabile'}`}
                />
              ))}
            </Box>
          )}
          <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {item.allergens.map((a) => (
              <Chip key={a} size="small" variant="outlined" label={allergenLabels[a] ?? a} />
            ))}
            {!item.available && <Chip size="small" color="warning" label="Non disponibile" />}
          </Box>
        </CardContent>
      </Box>
    </Card>
  );
}

/**
 * Menù pubblico, senza login: raggiunto dal QR al tavolo. In sviluppo
 * locale (senza sotto-domini) si può forzare il locale con
 * "?venueSlug=demo" nell'URL.
 *
 * Le categorie sono a fisarmonica (una sola voce alla volta, per non far
 * scorrere pagine infinite su schermi piccoli) e la barra di ricerca resta
 * fissa in alto mentre si scorre. Durante una ricerca le categorie con
 * risultati si aprono automaticamente, mostrando solo le voci che
 * corrispondono.
 */
export function PublicMenu() {
  const params = new URLSearchParams(window.location.search);
  const venueSlug = params.get('venueSlug');
  const [search, setSearch] = useState('');
  const [openCategory, setOpenCategory] = useState<string | false>(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const menuQuery = useQuery({
    queryKey: ['public-menu', venueSlug],
    queryFn: async () =>
      (
        await api.get<PublicMenuResponse>('/public/menu', {
          params: venueSlug ? { venueSlug } : undefined,
        })
      ).data,
  });

  const isSearching = search.trim() !== '';

  const filteredCategories = useMemo(() => {
    if (!menuQuery.data) return [];
    if (!isSearching) return menuQuery.data.categories;
    return menuQuery.data.categories
      .map((category) => ({ ...category, items: category.items.filter((i) => matches(i, search)) }))
      .filter((category) => category.items.length > 0);
  }, [menuQuery.data, search, isSearching]);

  /** In evidenza: le stesse voci restano anche nella propria categoria qui sotto. */
  const featuredItems = useMemo(() => {
    if (!menuQuery.data) return [];
    const all = menuQuery.data.categories.flatMap((c) => c.items).filter((i) => i.featured);
    return isSearching ? all.filter((i) => matches(i, search)) : all;
  }, [menuQuery.data, search, isSearching]);

  if (menuQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (menuQuery.isError || !menuQuery.data) {
    return (
      <Box sx={{ textAlign: 'center', mt: 6 }}>
        <Typography>Menù non disponibile.</Typography>
      </Box>
    );
  }

  const { venue } = menuQuery.data;
  const hasContacts =
    venue.address || venue.phone || venue.instagramUrl || venue.facebookUrl || venue.websiteUrl;

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      {venue.coverUrl ? (
        <Box
          onClick={() => setLightbox(venue.coverUrl!)}
          sx={{
            position: 'relative',
            width: '100%',
            height: { xs: 160, sm: 220, md: 320 },
            cursor: 'zoom-in',
          }}
        >
          <Box
            component="img"
            src={venue.coverUrl}
            alt={venue.name}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              background: 'linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0) 60%)',
            }}
          >
            <Typography
              variant="h4"
              fontWeight={700}
              textAlign="center"
              sx={{ color: 'white', px: 2, py: 1.5, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
            >
              {venue.name}
            </Typography>
          </Box>
        </Box>
      ) : (
        <Typography variant="h4" fontWeight={700} textAlign="center" sx={{ mt: 3, mb: 2, px: 2 }}>
          {venue.name}
        </Typography>
      )}

      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          bgcolor: 'background.default',
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder="Cerca nel menù..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <Box sx={{ p: { xs: 2, md: 4 } }}>
        {featuredItems.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1.5 }}>
              <StarIcon color="warning" fontSize="small" />
              <Typography variant="h6" fontWeight={700}>
                In evidenza
              </Typography>
            </Stack>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
                gap: 2,
              }}
            >
              {featuredItems.map((item) => (
                <MenuItemCard key={item.id} item={item} onImageClick={setLightbox} />
              ))}
            </Box>
          </Box>
        )}

        {filteredCategories.map((category) => (
          <Accordion
            key={category.id}
            expanded={isSearching || openCategory === category.id}
            onChange={(_e, expanded) => setOpenCategory(expanded ? category.id : false)}
            disableGutters
            TransitionProps={{ unmountOnExit: true }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6" fontWeight={700}>
                {category.name}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
                  gap: 2,
                }}
              >
                {category.items.map((item) => (
                  <MenuItemCard key={item.id} item={item} onImageClick={setLightbox} />
                ))}
              </Box>
            </AccordionDetails>
          </Accordion>
        ))}

        {filteredCategories.length === 0 && featuredItems.length === 0 && (
          <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 4 }}>
            Nessun piatto trovato.
          </Typography>
        )}

        {hasContacts && (
          <Box sx={{ textAlign: 'center', mt: 4, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" fontWeight={700}>
              {venue.name}
            </Typography>
            {venue.address && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {venue.address}
              </Typography>
            )}
            <Stack direction="row" spacing={1} justifyContent="center">
              {venue.phone && (
                <IconButton component="a" href={`tel:${venue.phone}`} title="Chiama">
                  <PhoneIcon />
                </IconButton>
              )}
              {venue.instagramUrl && (
                <IconButton component="a" href={venue.instagramUrl} target="_blank" rel="noopener noreferrer" title="Instagram">
                  <InstagramIcon />
                </IconButton>
              )}
              {venue.facebookUrl && (
                <IconButton component="a" href={venue.facebookUrl} target="_blank" rel="noopener noreferrer" title="Facebook">
                  <FacebookIcon />
                </IconButton>
              )}
              {venue.websiteUrl && (
                <IconButton component="a" href={venue.websiteUrl} target="_blank" rel="noopener noreferrer" title="Sito web">
                  <LanguageIcon />
                </IconButton>
              )}
            </Stack>
          </Box>
        )}
      </Box>

      <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </Box>
  );
}
