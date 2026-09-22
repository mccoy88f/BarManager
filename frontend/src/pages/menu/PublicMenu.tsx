import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardMedia,
  Chip,
  Stack,
  CircularProgress,
  IconButton,
} from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import InstagramIcon from '@mui/icons-material/Instagram';
import FacebookIcon from '@mui/icons-material/Facebook';
import LanguageIcon from '@mui/icons-material/Language';
import { api } from '../../api/client';

interface PublicMenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  photoUrl?: string;
  allergens: string[];
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

/**
 * Menù pubblico, senza login: raggiunto dal QR al tavolo. In sviluppo
 * locale (senza sotto-domini) si può forzare il locale con
 * "?venueSlug=demo" nell'URL.
 */
export function PublicMenu() {
  const params = new URLSearchParams(window.location.search);
  const venueSlug = params.get('venueSlug');

  const menuQuery = useQuery({
    queryKey: ['public-menu', venueSlug],
    queryFn: async () =>
      (
        await api.get<PublicMenuResponse>('/public/menu', {
          params: venueSlug ? { venueSlug } : undefined,
        })
      ).data,
  });

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
  const hasContacts = venue.phone || venue.instagramUrl || venue.facebookUrl || venue.websiteUrl;

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto' }}>
      {venue.coverUrl && (
        <Box
          component="img"
          src={venue.coverUrl}
          alt={venue.name}
          sx={{ width: '100%', height: { xs: 160, sm: 220 }, objectFit: 'cover', display: 'block' }}
        />
      )}

      <Box sx={{ p: 2 }}>
      <Typography variant="h4" fontWeight={700} textAlign="center" sx={{ my: 3 }}>
        {venue.name}
      </Typography>

      {menuQuery.data.categories.map((category) => (
        <Box key={category.id} sx={{ mb: 4 }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
            {category.name}
          </Typography>
          <Stack spacing={2}>
            {category.items.map((item) => (
              <Card key={item.id} variant="outlined" sx={{ opacity: item.available ? 1 : 0.6 }}>
                <Box sx={{ display: 'flex' }}>
                  {item.photoUrl && (
                    <CardMedia
                      component="img"
                      image={item.photoUrl}
                      alt={item.name}
                      sx={{ width: 96, height: 96, objectFit: 'cover' }}
                    />
                  )}
                  <CardContent sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {item.name}
                      </Typography>
                      <Typography variant="subtitle1" fontWeight={600}>
                        € {item.price.toFixed(2)}
                      </Typography>
                    </Box>
                    {item.description && (
                      <Typography variant="body2" color="text.secondary">
                        {item.description}
                      </Typography>
                    )}
                    <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {item.allergens.map((a) => (
                        <Chip key={a} size="small" variant="outlined" label={allergenLabels[a] ?? a} />
                      ))}
                      {!item.available && (
                        <Chip size="small" color="warning" label="Non disponibile" />
                      )}
                    </Box>
                  </CardContent>
                </Box>
              </Card>
            ))}
          </Stack>
        </Box>
      ))}

      {hasContacts && (
        <Box sx={{ textAlign: 'center', mt: 4, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
          {venue.phone && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {venue.phone}
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
    </Box>
  );
}
