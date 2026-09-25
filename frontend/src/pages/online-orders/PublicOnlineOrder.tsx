import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteIcon from '@mui/icons-material/Delete';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import PhoneIcon from '@mui/icons-material/Phone';
import { api } from '../../api/client';
import { QuarterHourTimeField } from '../../components/QuarterHourTimeField';
import { useCheckoutContactStore } from '../../store/checkoutContactStore';
import { mountSumUpCard, unmountSumUpCard, type SumUpCardResponse } from '../../payments/sumupCardWidget';

const SUMUP_CARD_ELEMENT_ID = 'sumup-card';

const LocationPicker = lazy(() =>
  import('../../components/LocationPicker').then((m) => ({ default: m.LocationPicker })),
);

/** Margine fisso di preparazione cucina (§5.10 di DEVELOPMENT.md), non configurabile: v. anche KITCHEN_MARGIN_MINUTES nel backend. */
const KITCHEN_MARGIN_MINUTES = 30;

interface OpeningHoursDay {
  dayOfWeek: number;
  closed: boolean;
  slot1Start: string | null;
  slot1End: string | null;
  slot2Start: string | null;
  slot2End: string | null;
}

interface OnlineOrdersInfo {
  name: string;
  onlineOrdersEnabled: boolean;
  onlineOrdersPickupEnabled: boolean;
  onlineOrdersDeliveryEnabled: boolean;
  openingHours: OpeningHoursDay[];
  onlineOrdersMinLeadMinutes: number;
  deliveryRadiusMeters: number | null;
  deliveryFee: number;
  deliveryFreeAboveAmount: number | null;
  sumupEnabled: boolean;
  sumupEnabledPaymentMethods: string[];
  menuAddress?: string;
  city?: string;
  menuPhone?: string;
}

interface ModifierOption {
  id: string;
  name: string;
  price: number;
}
interface ModifierGroup {
  id: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  minSelections: number;
  maxSelections: number | null;
  options: ModifierOption[];
}
interface MenuVariant {
  id: string;
  name: string;
  price: number | null;
}
interface MenuItem {
  id: string;
  name: string;
  description?: string;
  photoUrl?: string;
  variants: MenuVariant[];
  modifierGroups: { modifierGroup: ModifierGroup }[];
}
interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

interface CartLine {
  key: string;
  menuItemId: string;
  itemName: string;
  variantId: string;
  variantName: string;
  unitPrice: number;
  quantity: number;
  modifiers: ModifierOption[];
  note: string;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Come quarterHourOptionsForDay del widget prenotazioni, ma con la fascia ristretta del margine cucina fisso (§5.10). */
function quarterHourOptionsForDay(day: OpeningHoursDay | undefined): string[] {
  if (!day || day.closed) return [];
  const options: string[] = [];
  const addSlot = (start: string | null, end: string | null) => {
    if (!start || !end) return;
    const from = toMinutes(start) + KITCHEN_MARGIN_MINUTES;
    const to = toMinutes(end) - KITCHEN_MARGIN_MINUTES;
    for (let m = from; m <= to; m += 15) options.push(minutesToLabel(m));
  };
  addSlot(day.slot1Start, day.slot1End);
  addSlot(day.slot2Start, day.slot2End);
  return options;
}

function lineTotal(line: CartLine): number {
  return line.quantity * (line.unitPrice + line.modifiers.reduce((sum, m) => sum + m.price, 0));
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Non è stato possibile inviare la richiesta. Riprova più tardi.';
}

/** Dialog di scelta variante/modificatori/quantità per una voce, prima di aggiungerla al carrello. */
function AddToCartDialog({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (line: Omit<CartLine, 'key'>) => void;
}) {
  const [variantId, setVariantId] = useState(item.variants[0]?.id ?? '');
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  const variant = item.variants.find((v) => v.id === variantId);
  const groups = item.modifierGroups.map((g) => g.modifierGroup);

  const allOptions = groups.flatMap((g) => (selectedOptions[g.id] ?? []).map((optId) => g.options.find((o) => o.id === optId)!));
  const unitPrice = (variant?.price ?? 0) + allOptions.reduce((sum, o) => sum + o.price, 0);

  const missingRequired = groups.some((g) => (selectedOptions[g.id]?.length ?? 0) < g.minSelections);

  const toggleOption = (group: ModifierGroup, optionId: string) => {
    setSelectedOptions((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selectionType === 'SINGLE') {
        return { ...prev, [group.id]: current.includes(optionId) ? [] : [optionId] };
      }
      const max = group.maxSelections ?? Infinity;
      if (current.includes(optionId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      }
      if (current.length >= max) return prev;
      return { ...prev, [group.id]: [...current, optionId] };
    });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{item.name}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
        {item.description && (
          <Typography variant="body2" color="text.secondary">
            {item.description}
          </Typography>
        )}

        {item.variants.length > 1 && (
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
              Formato
            </Typography>
            <RadioGroup value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              {item.variants.map((v) => (
                <FormControlLabel
                  key={v.id}
                  value={v.id}
                  control={<Radio />}
                  label={`${v.name || 'Standard'} — € ${(v.price ?? 0).toFixed(2)}`}
                />
              ))}
            </RadioGroup>
          </Box>
        )}

        {groups.map((group) => (
          <Box key={group.id}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
              {group.name}
              {group.minSelections > 0 && (
                <Typography component="span" variant="caption" color="text.secondary">
                  {' '}
                  (obbligatorio)
                </Typography>
              )}
            </Typography>
            <Stack spacing={0.5}>
              {group.options.map((option) => (
                <FormControlLabel
                  key={option.id}
                  control={
                    <Switch
                      size="small"
                      checked={(selectedOptions[group.id] ?? []).includes(option.id)}
                      onChange={() => toggleOption(group, option.id)}
                    />
                  }
                  label={`${option.name}${option.price > 0 ? ` (+€ ${option.price.toFixed(2)})` : ''}`}
                />
              ))}
            </Stack>
          </Box>
        ))}

        <TextField
          label="Note (opzionale, es. senza ghiaccio)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <Stack direction="row" spacing={2} alignItems="center" justifyContent="center">
          <IconButton onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
            <RemoveIcon />
          </IconButton>
          <Typography variant="h6">{quantity}</Typography>
          <IconButton onClick={() => setQuantity((q) => q + 1)}>
            <AddIcon />
          </IconButton>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose}>Annulla</Button>
        <Button
          variant="contained"
          disabled={!variant || missingRequired}
          onClick={() =>
            onAdd({
              menuItemId: item.id,
              itemName: item.name,
              variantId: variant!.id,
              variantName: variant!.name,
              unitPrice: variant!.price ?? 0,
              quantity,
              modifiers: allOptions,
              note: note.trim(),
            })
          }
        >
          Aggiungi — € {(unitPrice * quantity).toFixed(2)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Passo di pagamento con carta (§5.10 di DEVELOPMENT.md): monta il Web
 * Payment Widget di SumUp per il `checkoutId` già creato lato server
 * (importo, valuta e descrizione decisi dal backend, mai dal client) e
 * attende l'esito dal widget stesso prima di procedere — i dati di carta
 * non passano mai per BarManager. "Annulla" chiude senza completare
 * l'ordine: il carrello resta intatto, un nuovo tentativo crea un nuovo
 * checkout.
 */
function SumUpCardDialog({
  checkoutId,
  total,
  onSuccess,
  onCancel,
}: {
  checkoutId: string;
  total: number;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    mountSumUpCard(SUMUP_CARD_ELEMENT_ID, checkoutId, (type, data: SumUpCardResponse) => {
      if (!active) return;
      if (type === 'success') {
        onSuccess();
        return;
      }
      if (type === 'error') {
        setError(data?.message || 'Pagamento non riuscito: verifica i dati della carta e riprova.');
      }
      // 'sent' (invio in corso) e 'invalid' (errori di validazione, già
      // mostrati dal widget stesso) non richiedono nessuna azione qui.
    })
      .then(() => {
        if (active) setLoading(false);
      })
      .catch(() => {
        if (active) {
          setLoading(false);
          setError('Impossibile caricare il modulo di pagamento. Riprova più tardi o scegli un altro metodo.');
        }
      });
    return () => {
      active = false;
      unmountSumUpCard(SUMUP_CARD_ELEMENT_ID);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutId]);

  return (
    <Dialog open onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Pagamento con carta</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
        <Typography variant="body2" color="text.secondary">
          Importo da pagare: € {total.toFixed(2)}
        </Typography>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        <div id={SUMUP_CARD_ELEMENT_ID} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onCancel}>Annulla</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Checkout pubblico /ordina (§5.10 di DEVELOPMENT.md), nessun login:
 * pagina "gemella" di /menu ma con carrello, scelta ritiro/consegna e
 * pagamento. In sviluppo locale si può forzare il locale con
 * "?venueSlug=demo", come per le altre pagine pubbliche.
 */
export function PublicOnlineOrder() {
  const params = new URLSearchParams(window.location.search);
  const venueSlug = params.get('venueSlug');
  const contactCache = useCheckoutContactStore();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [addingItem, setAddingItem] = useState<MenuItem | null>(null);
  const [fulfillment, setFulfillment] = useState<'PICKUP' | 'DELIVERY' | ''>('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [firstName, setFirstName] = useState(contactCache.firstName);
  const [lastName, setLastName] = useState(contactCache.lastName);
  const [email, setEmail] = useState(contactCache.email);
  const [phone, setPhone] = useState(contactCache.phone);
  const [address, setAddress] = useState(contactCache.deliveryAddress);
  const [lat, setLat] = useState<number | null>(contactCache.deliveryLat);
  const [lng, setLng] = useState<number | null>(contactCache.deliveryLng);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD_ONLINE'>('CASH');
  const [marketingConsent, setMarketingConsent] = useState(true);
  const [privacyPolicyConsent, setPrivacyPolicyConsent] = useState(true);
  const [orderResult, setOrderResult] = useState<{ id: string; manageToken: string } | null>(null);
  const [sumupCheckout, setSumupCheckout] = useState<{ checkoutId: string; total: number } | null>(null);

  const infoQuery = useQuery({
    queryKey: ['public-online-orders-info', venueSlug],
    queryFn: async () =>
      (
        await api.get<OnlineOrdersInfo>('/public/online-orders/info', {
          params: venueSlug ? { venueSlug } : undefined,
        })
      ).data,
  });

  const menuQuery = useQuery({
    queryKey: ['public-online-orders-menu', venueSlug],
    queryFn: async () =>
      (
        await api.get<MenuCategory[]>('/public/online-orders/menu', {
          params: venueSlug ? { venueSlug } : undefined,
        })
      ).data,
    enabled: !!infoQuery.data,
  });

  const geocodeMutation = useMutation({
    mutationFn: async () =>
      (
        await api.get<{ lat: number; lng: number; displayName: string } | null>(
          '/public/online-orders/geocode',
          { params: { address, venueSlug: venueSlug ?? undefined } },
        )
      ).data,
    onSuccess: (data) => {
      if (!data) {
        setGeocodeError('Indirizzo non trovato: prova a correggerlo o sposta il puntatore sulla mappa.');
        return;
      }
      setGeocodeError(null);
      setLat(data.lat);
      setLng(data.lng);
    },
  });

  /** Righe carrello nel formato richiesto dall'API, condivise fra checkout SumUp e creazione ordine finale. */
  const buildLines = () =>
    cart.map((line) => ({
      menuItemId: line.menuItemId,
      variantId: line.variantId,
      quantity: line.quantity,
      modifierOptionIds: line.modifiers.map((m) => m.id),
      note: line.note || undefined,
    }));

  const requestedAtIso = () => new Date(`${date}T${time}:00`).toISOString();

  /** Crea il checkout SumUp per l'importo del carrello e apre il dialog col widget di pagamento (§5.10). */
  const createSumupCheckoutMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ checkoutId: string; total: number }>(
          '/public/online-orders/sumup-checkout',
          { cart: { lines: buildLines() }, requestedAt: requestedAtIso(), deliveryAddress: address, deliveryLat: lat, deliveryLng: lng },
          { params: venueSlug ? { venueSlug } : undefined },
        )
      ).data,
    onSuccess: (data) => setSumupCheckout(data),
  });

  /** Crea l'ordine vero e proprio: `sumupCheckoutId` solo dopo che il widget SumUp ha già raccolto ed elaborato il pagamento. */
  const finalizeOrderMutation = useMutation({
    mutationFn: async (sumupCheckoutId?: string) =>
      (
        await api.post<{ id: string; manageToken: string }>(
          '/public/online-orders',
          {
            lines: buildLines(),
            fulfillment,
            requestedAt: requestedAtIso(),
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            phone: phone.trim(),
            deliveryAddress: fulfillment === 'DELIVERY' ? address.trim() : undefined,
            deliveryLat: fulfillment === 'DELIVERY' ? lat ?? undefined : undefined,
            deliveryLng: fulfillment === 'DELIVERY' ? lng ?? undefined : undefined,
            paymentMethod: fulfillment === 'DELIVERY' ? paymentMethod : undefined,
            sumupCheckoutId,
            marketingConsent,
            privacyPolicyConsent,
          },
          { params: venueSlug ? { venueSlug } : undefined },
        )
      ).data,
    onSuccess: (data) => {
      contactCache.setContact({
        firstName,
        lastName,
        email,
        phone,
        deliveryAddress: fulfillment === 'DELIVERY' ? address : undefined,
        deliveryLat: fulfillment === 'DELIVERY' ? lat : undefined,
        deliveryLng: fulfillment === 'DELIVERY' ? lng : undefined,
      });
      setSumupCheckout(null);
      setOrderResult(data);
      setCart([]);
    },
  });

  /** Punto di ingresso del pulsante "Conferma ordine": per la carta online passa prima dal widget di pagamento, per gli altri casi crea l'ordine direttamente. */
  const startCheckout = () => {
    if (fulfillment === 'DELIVERY' && paymentMethod === 'CARD_ONLINE') {
      createSumupCheckoutMutation.mutate();
    } else {
      finalizeOrderMutation.mutate(undefined);
    }
  };

  const info = infoQuery.data;
  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + lineTotal(line), 0), [cart]);
  const deliveryFee =
    fulfillment === 'DELIVERY' && info
      ? info.deliveryFreeAboveAmount != null && subtotal >= info.deliveryFreeAboveAmount
        ? 0
        : info.deliveryFee
      : 0;
  const total = subtotal + deliveryFee;

  const today = new Date().toISOString().slice(0, 10);
  const selectedDaySchedule = date
    ? info?.openingHours.find((d) => d.dayOfWeek === new Date(`${date}T00:00:00`).getDay())
    : undefined;
  const dayClosed = !!date && !!selectedDaySchedule?.closed;
  const timeOptions = date ? quarterHourOptionsForDay(selectedDaySchedule) : undefined;

  const canSubmit =
    cart.length > 0 &&
    !!fulfillment &&
    date &&
    time &&
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    phone.trim() &&
    privacyPolicyConsent &&
    (fulfillment !== 'DELIVERY' || (address.trim() && lat != null && lng != null));

  if (infoQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (infoQuery.isError || !info || !info.onlineOrdersEnabled) {
    return (
      <Box sx={{ textAlign: 'center', mt: 6 }}>
        <Typography>Gli ordini online non sono disponibili per questo locale.</Typography>
      </Box>
    );
  }

  if (orderResult) {
    const trackUrl = `/ordina/traccia/${orderResult.id}?token=${orderResult.manageToken}${venueSlug ? `&venueSlug=${venueSlug}` : ''}`;
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 6, px: 2 }}>
        <Alert severity="success">Ordine ricevuto! Riceverai una email di aggiornamento a {email}.</Alert>
        <Button variant="contained" fullWidth sx={{ mt: 2 }} href={trackUrl}>
          Traccia il tuo ordine
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', px: 2, py: 4 }}>
      <Typography variant="h5" fontWeight={700} textAlign="center" gutterBottom>
        Ordina online — {info.name}
      </Typography>

      {menuQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {menuQuery.data?.map((category) => (
        <Box key={category.id} sx={{ mt: 3 }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
            {category.name}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
              gap: 2,
            }}
          >
            {category.items.map((item) => {
              const priced = item.variants.filter((v) => v.price != null);
              const priceLabel =
                priced.length === 1
                  ? `€ ${priced[0].price!.toFixed(2)}`
                  : priced.length > 1
                    ? `da € ${Math.min(...priced.map((v) => v.price!)).toFixed(2)}`
                    : '';
              return (
                <Card
                  key={item.id}
                  variant="outlined"
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setAddingItem(item)}
                >
                  <Box sx={{ display: 'flex' }}>
                    {item.photoUrl && (
                      <CardMedia
                        component="img"
                        image={item.photoUrl}
                        alt={item.name}
                        sx={{ width: 88, height: 88, objectFit: 'cover' }}
                      />
                    )}
                    <CardContent sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle1" fontWeight={600}>
                          {item.name}
                        </Typography>
                        <Typography variant="subtitle1" fontWeight={600}>
                          {priceLabel}
                        </Typography>
                      </Box>
                      {item.description && (
                        <Typography variant="body2" color="text.secondary">
                          {item.description}
                        </Typography>
                      )}
                    </CardContent>
                  </Box>
                </Card>
              );
            })}
          </Box>
        </Box>
      ))}

      {addingItem && (
        <AddToCartDialog
          item={addingItem}
          onClose={() => setAddingItem(null)}
          onAdd={(line) => {
            setCart((prev) => [...prev, { ...line, key: `${Date.now()}-${Math.random()}` }]);
            setAddingItem(null);
          }}
        />
      )}

      <Divider sx={{ my: 4 }} />

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <ShoppingCartIcon />
        <Typography variant="h6" fontWeight={700}>
          Il tuo carrello
        </Typography>
      </Stack>

      {cart.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Il carrello è vuoto: scegli qualcosa dal menù sopra.
        </Typography>
      ) : (
        <Card variant="outlined">
          <CardContent sx={{ display: 'grid', gap: 1.5 }}>
            {cart.map((line) => (
              <Box key={line.key} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {line.quantity}× {line.itemName}
                    {line.variantName ? ` (${line.variantName})` : ''}
                  </Typography>
                  {line.modifiers.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {line.modifiers.map((m) => m.name).join(', ')}
                    </Typography>
                  )}
                  {line.note && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Nota: {line.note}
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2">€ {lineTotal(line).toFixed(2)}</Typography>
                  <IconButton size="small" onClick={() => setCart((prev) => prev.filter((l) => l.key !== line.key))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Box>
            ))}
            <Divider />
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body2">Subtotale</Typography>
              <Typography variant="body2">€ {subtotal.toFixed(2)}</Typography>
            </Box>
            {fulfillment === 'DELIVERY' && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2">Consegna</Typography>
                <Typography variant="body2">{deliveryFee > 0 ? `€ ${deliveryFee.toFixed(2)}` : 'Gratuita'}</Typography>
              </Box>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="subtitle1" fontWeight={700}>
                Totale
              </Typography>
              <Typography variant="subtitle1" fontWeight={700}>
                € {total.toFixed(2)}
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      {cart.length > 0 && (
        <Card variant="outlined" sx={{ mt: 3 }}>
          <CardContent sx={{ display: 'grid', gap: 2 }}>
            <Typography variant="h6">Ritiro o consegna?</Typography>
            <ToggleButtonGroup
              value={fulfillment}
              exclusive
              onChange={(_e, value) => value && setFulfillment(value)}
            >
              {info.onlineOrdersPickupEnabled && <ToggleButton value="PICKUP">Ritiro in negozio</ToggleButton>}
              {info.onlineOrdersDeliveryEnabled && <ToggleButton value="DELIVERY">Consegna a domicilio</ToggleButton>}
            </ToggleButtonGroup>

            {fulfillment && (
              <>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Data"
                    type="date"
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ min: today }}
                    fullWidth
                    value={date}
                    onChange={(e) => { setDate(e.target.value); setTime(''); }}
                  />
                  <QuarterHourTimeField
                    label={fulfillment === 'PICKUP' ? 'Orario di ritiro' : 'Orario di consegna'}
                    fullWidth
                    value={time}
                    onChange={setTime}
                    options={timeOptions}
                    disabled={dayClosed}
                  />
                </Stack>
                {dayClosed && (
                  <Alert severity="warning">Il locale è chiuso in questo giorno: scegli un&apos;altra data.</Alert>
                )}
              </>
            )}

            {fulfillment === 'DELIVERY' && (
              <Box sx={{ display: 'grid', gap: 1.5 }}>
                <Stack direction="row" spacing={1}>
                  <TextField
                    label="Indirizzo di consegna"
                    fullWidth
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                  <Button
                    variant="outlined"
                    sx={{ flexShrink: 0 }}
                    disabled={!address.trim() || geocodeMutation.isPending}
                    onClick={() => geocodeMutation.mutate()}
                  >
                    Cerca
                  </Button>
                </Stack>
                {geocodeError && <Alert severity="warning">{geocodeError}</Alert>}
                <Suspense
                  fallback={
                    <Box sx={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CircularProgress size={24} />
                    </Box>
                  }
                >
                  <LocationPicker
                    lat={lat}
                    lng={lng}
                    radiusMeters={info.deliveryRadiusMeters ?? undefined}
                    onChange={(newLat, newLng) => {
                      setLat(newLat);
                      setLng(newLng);
                      setGeocodeError(null);
                    }}
                  />
                </Suspense>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {fulfillment && (
        <Card variant="outlined" sx={{ mt: 3 }}>
          <CardContent sx={{ display: 'grid', gap: 2 }}>
            <Typography variant="h6">I tuoi dati</Typography>
            <Stack direction="row" spacing={2}>
              <TextField label="Nome" fullWidth value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <TextField label="Cognome" fullWidth value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Stack>
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <TextField label="Telefono" value={phone} onChange={(e) => setPhone(e.target.value)} />

            {fulfillment === 'DELIVERY' && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                  Pagamento
                </Typography>
                <RadioGroup
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'CARD_ONLINE')}
                >
                  <FormControlLabel value="CASH" control={<Radio />} label="Contanti alla consegna" />
                  {info.sumupEnabled && info.sumupEnabledPaymentMethods.length > 0 && (
                    <FormControlLabel value="CARD_ONLINE" control={<Radio />} label="Carta online" />
                  )}
                </RadioGroup>
              </Box>
            )}
            {fulfillment === 'PICKUP' && (
              <Alert severity="info">
                Il pagamento (contanti o carta) si effettua direttamente in negozio al momento del ritiro.
              </Alert>
            )}

            <FormControlLabel
              control={<Switch checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} />}
              label="Accetto di ricevere comunicazioni promozionali via email (facoltativo)"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={privacyPolicyConsent}
                  onChange={(e) => setPrivacyPolicyConsent(e.target.checked)}
                />
              }
              label="Autorizzo il trattamento dei dati personali secondo la normativa vigente (obbligatorio)"
            />
            {!privacyPolicyConsent && (
              <Alert severity="warning">Devi autorizzare il trattamento dei dati personali per ordinare.</Alert>
            )}

            {finalizeOrderMutation.isError && (
              <Alert severity="error">{extractErrorMessage(finalizeOrderMutation.error)}</Alert>
            )}
            {createSumupCheckoutMutation.isError && (
              <Alert severity="error">{extractErrorMessage(createSumupCheckoutMutation.error)}</Alert>
            )}

            <Button
              variant="contained"
              size="large"
              disabled={!canSubmit || finalizeOrderMutation.isPending || createSumupCheckoutMutation.isPending}
              onClick={startCheckout}
            >
              {finalizeOrderMutation.isPending || createSumupCheckoutMutation.isPending
                ? 'Invio in corso…'
                : fulfillment === 'DELIVERY' && paymentMethod === 'CARD_ONLINE'
                  ? `Paga e conferma ordine — € ${total.toFixed(2)}`
                  : `Conferma ordine — € ${total.toFixed(2)}`}
            </Button>
          </CardContent>
        </Card>
      )}

      {sumupCheckout && (
        <SumUpCardDialog
          checkoutId={sumupCheckout.checkoutId}
          total={sumupCheckout.total}
          onSuccess={() => {
            // Chiude subito il dialog di pagamento: il widget ha già dato
            // esito positivo, da qui in avanti un eventuale errore
            // riguarda solo la creazione dell'ordine (mostrato dall'Alert
            // sotto il pulsante principale), non il pagamento in sé.
            const checkoutId = sumupCheckout.checkoutId;
            setSumupCheckout(null);
            finalizeOrderMutation.mutate(checkoutId);
          }}
          onCancel={() => setSumupCheckout(null)}
        />
      )}

      {info.menuPhone && (
        <Box sx={{ textAlign: 'center', mt: 4, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
          <IconButton component="a" href={`tel:${info.menuPhone}`} title="Chiama">
            <PhoneIcon />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}
