import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Typography } from '@mui/material';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import CloudIcon from '@mui/icons-material/Cloud';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import ThunderstormIcon from '@mui/icons-material/Thunderstorm';
import { api } from '../../api/client';

interface DisplayPromoMedia {
  id: string;
  type: 'PHOTO' | 'VIDEO';
  url: string;
  durationSeconds: number | null;
}
interface DisplayPromoPlaylist {
  id: string;
  name: string;
  items: DisplayPromoMedia[];
}
interface DisplayPromoScreenData {
  venueName: string;
  playlist: DisplayPromoPlaylist | null;
  infoBar: {
    enabled: boolean;
    weather: { lat: number; lng: number } | null;
  };
}

const DEFAULT_PHOTO_SECONDS = 8;
// Non critico in tempo reale come gli ordini online: un minuto di ritardo
// nel recepire una modifica dal gestionale è accettabile per uno schermo
// pubblicitario, e tiene il traffico di polling basso su schermi sempre
// accesi (§5.12 di DEVELOPMENT.md).
const POLL_INTERVAL_MS = 60000;
const WEATHER_POLL_MS = 30 * 60000;
const NEWS_POLL_MS = 15 * 60000;

/** Firma leggera per sapere se la playlist attiva è cambiata (nuova playlist O contenuti riordinati/aggiunti dentro la stessa). */
function playlistSignature(playlist: DisplayPromoPlaylist | null | undefined): string {
  if (!playlist) return '';
  return `${playlist.id}:${playlist.items.map((i) => i.id).join(',')}`;
}

/** Carosello foto/video a schermo intero (o nell'area centrale, se è attiva la fascia orologio/meteo/notizie). */
function Carousel({ playlist }: { playlist: DisplayPromoPlaylist | null }) {
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const items = playlist?.items ?? [];
  const signature = playlistSignature(playlist);

  // Una modifica dal gestionale (nuova playlist per il turno, contenuto
  // aggiunto/rimosso) riparte sempre dal primo contenuto invece di tenere
  // un indice che potrebbe non esistere più nella nuova lista.
  useEffect(() => {
    setIndex(0);
  }, [signature]);

  const current = items.length > 0 ? items[index % items.length] : null;

  const advance = () => setIndex((i) => (items.length > 0 ? (i + 1) % items.length : 0));

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!current || current.type !== 'PHOTO') return;
    const seconds = current.durationSeconds ?? DEFAULT_PHOTO_SECONDS;
    timerRef.current = setTimeout(advance, seconds * 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) return null;

  const fillStyle = { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'cover' as const };

  return current.type === 'VIDEO' ? (
    <video
      key={current.id}
      src={current.url}
      autoPlay
      muted
      playsInline
      onEnded={advance}
      onError={advance}
      style={fillStyle}
    />
  ) : (
    <Box key={current.id} component="img" src={current.url} onError={advance} sx={fillStyle} />
  );
}

/** Orologio dal vivo (HH:mm:ss + data), aggiornato ogni secondo — nessuna chiamata di rete. */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Box sx={{ textAlign: 'right' }}>
      <Typography variant="h4" fontWeight={700} sx={{ color: 'white', lineHeight: 1 }}>
        {time}
      </Typography>
      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', textTransform: 'capitalize' }}>
        {date}
      </Typography>
    </Box>
  );
}

/** Codici meteo WMO (Open-Meteo) raggruppati sulle icone che servono qui, non una mappatura esaustiva. */
function weatherIcon(code: number) {
  if (code === 0) return WbSunnyIcon;
  if (code >= 51 && code <= 67) return WaterDropIcon;
  if (code >= 80 && code <= 82) return WaterDropIcon;
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return AcUnitIcon;
  if (code >= 95) return ThunderstormIcon;
  return CloudIcon;
}

/**
 * Meteo attuale: chiamata diretta dal browser a Open-Meteo (gratuita, CORS
 * aperto, nessuna chiave) con le coordinate del locale — nessun proxy
 * backend necessario, a differenza del ticker notizie sotto (feed RSS, che
 * invece il browser non può leggere per CORS).
 */
function WeatherWidget({ lat, lng }: { lat: number; lng: number }) {
  const weatherQuery = useQuery({
    queryKey: ['public-display-promo-weather', lat, lng],
    queryFn: async () => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('weather fetch failed');
      const data = await response.json();
      return data.current_weather as { temperature: number; weathercode: number };
    },
    refetchInterval: WEATHER_POLL_MS,
    retry: 1,
  });

  if (!weatherQuery.data) return null;
  const Icon = weatherIcon(weatherQuery.data.weathercode);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'white' }}>
      <Icon sx={{ fontSize: 40 }} />
      <Typography variant="h4" fontWeight={700}>
        {Math.round(weatherQuery.data.temperature)}°
      </Typography>
    </Box>
  );
}

/** Striscia "ultim'ora" in loop continuo da destra a sinistra, come un vero ticker all-news. */
function NewsTicker({ screenId }: { screenId: string }) {
  const newsQuery = useQuery({
    queryKey: ['public-display-promo-news', screenId],
    queryFn: async () => (await api.get<{ headlines: string[] }>(`/public/display-promo/${screenId}/news`)).data,
    refetchInterval: NEWS_POLL_MS,
  });

  const headlines = newsQuery.data?.headlines ?? [];
  if (headlines.length === 0) return null;
  // Testo duplicato una volta: con "translate3d" da 0% a -50% il ciclo
  // appare continuo, senza scatto visibile al punto di ricongiunzione.
  const text = headlines.join('   •   ');

  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', overflow: 'hidden', height: 56 }}>
      <Box
        sx={{
          bgcolor: 'error.main',
          color: 'white',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          px: 2,
          flexShrink: 0,
          letterSpacing: 1,
        }}
      >
        ULTIM'ORA
      </Box>
      <Box sx={{ position: 'relative', flex: 1, overflow: 'hidden', bgcolor: 'rgba(0,0,0,0.85)' }}>
        <Box
          sx={{
            position: 'absolute',
            whiteSpace: 'nowrap',
            display: 'flex',
            height: '100%',
            alignItems: 'center',
            willChange: 'transform',
            animation: `display-promo-ticker ${Math.max(20, headlines.length * 6)}s linear infinite`,
            '@keyframes display-promo-ticker': {
              from: { transform: 'translate3d(0, 0, 0)' },
              to: { transform: 'translate3d(-50%, 0, 0)' },
            },
          }}
        >
          <Typography component="span" sx={{ color: 'white', px: 2, fontSize: '1.4rem' }}>
            {text}
          </Typography>
          <Typography component="span" sx={{ color: 'white', px: 2, fontSize: '1.4rem' }}>
            {text}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Pagina pubblica /display/:screenId (§5.12 di DEVELOPMENT.md): a tutto
 * schermo, per TV/tablet collegati in loop (orizzontali o verticali,
 * nessun vincolo di orientamento lato pagina — il layout si adatta al
 * viewport del dispositivo). Nessun login; a differenza delle altre
 * pagine pubbliche l'id dello schermo identifica già il locale, non serve
 * sottodominio/`?venueSlug=` — ogni display ha il proprio link/QR
 * (DisplayPromoAdmin.tsx), dato che un locale può averne più di uno.
 *
 * Fascia "da telegiornale" (orologio/meteo/notizie) opzionale per singolo
 * display (screen.infoBar.enabled): chi la lascia disattivata vede solo
 * il carosello a schermo intero, comportamento storico del modulo.
 */
export function PublicDisplayPromo() {
  const { screenId } = useParams<{ screenId: string }>();

  const screenQuery = useQuery({
    queryKey: ['public-display-promo', screenId],
    queryFn: async () => (await api.get<DisplayPromoScreenData>(`/public/display-promo/${screenId}`)).data,
    enabled: !!screenId,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const containerStyle = useMemo(
    () =>
      ({
        position: 'fixed' as const,
        inset: 0,
        bgcolor: 'black',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column' as const,
      }) as const,
    [],
  );

  if (screenQuery.isLoading) {
    return <Box sx={containerStyle} />;
  }

  if (screenQuery.isError || !screenQuery.data) {
    return (
      <Box sx={{ ...containerStyle, alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.4)' }}>
          Display non disponibile.
        </Typography>
      </Box>
    );
  }

  const data = screenQuery.data;

  if (!data.infoBar.enabled) {
    return (
      <Box sx={{ ...containerStyle, alignItems: 'center', justifyContent: 'center' }}>
        <Carousel playlist={data.playlist} />
      </Box>
    );
  }

  return (
    <Box sx={containerStyle}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, flexShrink: 0 }}>
        <Typography variant="h5" fontWeight={700} sx={{ color: 'white' }}>
          {data.venueName}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {data.infoBar.weather && <WeatherWidget lat={data.infoBar.weather.lat} lng={data.infoBar.weather.lng} />}
          <LiveClock />
        </Box>
      </Box>

      <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <Carousel playlist={data.playlist} />
      </Box>

      <Box sx={{ flexShrink: 0 }}>
        <NewsTicker screenId={screenId!} />
      </Box>
    </Box>
  );
}
