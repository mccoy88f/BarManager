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

type TransitionEffect = 'NONE' | 'FADE' | 'SLIDE_HORIZONTAL' | 'SLIDE_VERTICAL' | 'ZOOM';
type InfoBarTheme = 'BLACK_WHITE' | 'GLASS';

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
  transitionEffect: TransitionEffect;
  infoBar: {
    enabled: boolean;
    theme: InfoBarTheme;
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
const TRANSITION_MS = 800;
const HEADER_HEIGHT = 100;
const TICKER_HEIGHT = 56;

/** Firma leggera per sapere se la playlist attiva è cambiata (nuova playlist O contenuti riordinati/aggiunti dentro la stessa). */
function playlistSignature(playlist: DisplayPromoPlaylist | null | undefined): string {
  if (!playlist) return '';
  return `${playlist.id}:${playlist.items.map((i) => i.id).join(',')}`;
}

/**
 * Immagine di riserva, caricata una volta e tenuta in cache dal browser
 * (è anche fra gli asset precaricati dal service worker della PWA, v.
 * `includeAssets` in vite.config.ts): mostrata finché non c'è altro da
 * mostrare — nessun contenuto caricato, playlist vuota, errore di rete —
 * mai un riquadro nero o rotto su un display pubblico incustodito.
 */
function FallbackScreen() {
  const fillStyle = { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'cover' as const };
  return <Box component="img" src="/display-promo-fallback.svg" sx={fillStyle} />;
}

/**
 * Keyframe di entrata/uscita per ciascuna animazione (§5.12): NONE non ne
 * usa nessuna (taglio netto, comportamento storico, zero livelli
 * sovrapposti). Le altre si applicano al layer che entra ("in") e a quello
 * che esce ("out"), sovrapposti per la durata della transizione.
 */
const TRANSITION_KEYFRAMES = {
  '@keyframes dpFadeIn': { from: { opacity: 0 }, to: { opacity: 1 } },
  '@keyframes dpFadeOut': { from: { opacity: 1 }, to: { opacity: 0 } },
  '@keyframes dpSlideHIn': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
  '@keyframes dpSlideHOut': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-100%)' } },
  '@keyframes dpSlideVIn': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
  '@keyframes dpSlideVOut': { from: { transform: 'translateY(0)' }, to: { transform: 'translateY(-100%)' } },
  '@keyframes dpZoomIn': { from: { transform: 'scale(1.15)', opacity: 0 }, to: { transform: 'scale(1)', opacity: 1 } },
  '@keyframes dpZoomOut': { from: { transform: 'scale(1)', opacity: 1 }, to: { transform: 'scale(0.92)', opacity: 0 } },
} as const;

const TRANSITION_ANIMATIONS: Record<TransitionEffect, { enter: string; exit: string } | null> = {
  NONE: null,
  FADE: { enter: 'dpFadeIn', exit: 'dpFadeOut' },
  SLIDE_HORIZONTAL: { enter: 'dpSlideHIn', exit: 'dpSlideHOut' },
  SLIDE_VERTICAL: { enter: 'dpSlideVIn', exit: 'dpSlideVOut' },
  ZOOM: { enter: 'dpZoomIn', exit: 'dpZoomOut' },
};

interface MediaLayerProps {
  media: DisplayPromoMedia;
  animationName: string | null;
  zIndex: number;
  onEnded?: () => void;
  onLoaded?: () => void;
  onError?: () => void;
}

/** Un singolo contenuto (foto o video) a tutta area, con l'eventuale animazione di entrata/uscita applicata. */
function MediaLayer({ media, animationName, zIndex, onEnded, onLoaded, onError }: MediaLayerProps) {
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex,
        animation: animationName ? `${animationName} ${TRANSITION_MS}ms ease forwards` : undefined,
        ...TRANSITION_KEYFRAMES,
      }}
    >
      {media.type === 'VIDEO' ? (
        <video
          src={media.url}
          autoPlay
          muted
          playsInline
          onEnded={onEnded}
          onLoadedData={onLoaded}
          onError={onError}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <Box
          component="img"
          src={media.url}
          onLoad={onLoaded}
          onError={onError}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
    </Box>
  );
}

/** Carosello foto/video a schermo intero (o nell'area centrale, se è attiva la fascia orologio/meteo/notizie). */
function Carousel({ playlist, transitionEffect }: { playlist: DisplayPromoPlaylist | null; transitionEffect: TransitionEffect }) {
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<DisplayPromoMedia | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failCountRef = useRef(0);
  const items = playlist?.items ?? [];
  const signature = playlistSignature(playlist);
  const current = items.length > 0 ? items[index % items.length] : null;
  const animations = TRANSITION_ANIMATIONS[transitionEffect];

  // Una modifica dal gestionale (nuova playlist per il turno, contenuto
  // aggiunto/rimosso) riparte sempre dal primo contenuto invece di tenere
  // un indice che potrebbe non esistere più nella nuova lista, e azzera
  // anche lo stato di fallback: è una playlist diversa, merita un
  // tentativo pulito.
  useEffect(() => {
    setIndex(0);
    setPrevious(null);
    failCountRef.current = 0;
    setShowFallback(false);
  }, [signature]);

  // Finché siamo sul fallback, riprova a caricare un contenuto vero ogni
  // minuto (stesso ritmo del polling della playlist sotto) invece di
  // restare bloccati lì per sempre una volta tornata la connessione.
  useEffect(() => {
    if (!showFallback) return;
    const id = setInterval(() => {
      failCountRef.current = 0;
      setShowFallback(false);
      setRetryTick((t) => t + 1);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [showFallback]);

  const advance = () => {
    if (items.length === 0) return;
    if (animations) {
      setPrevious(current);
      if (previousTimerRef.current) clearTimeout(previousTimerRef.current);
      previousTimerRef.current = setTimeout(() => setPrevious(null), TRANSITION_MS);
    }
    setIndex((i) => (i + 1) % items.length);
  };

  const handleError = () => {
    failCountRef.current += 1;
    // Se è andato in errore un intero giro di contenuti, probabilmente non
    // è un singolo file rotto ma la rete: meglio fermarsi sul fallback che
    // continuare a lampeggiare tra contenuti rotti all'infinito.
    if (failCountRef.current >= items.length) {
      setShowFallback(true);
    } else {
      advance();
    }
  };

  const handleLoaded = () => {
    failCountRef.current = 0;
  };

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!current || current.type !== 'PHOTO' || showFallback) return;
    const seconds = current.durationSeconds ?? DEFAULT_PHOTO_SECONDS;
    timerRef.current = setTimeout(advance, seconds * 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, showFallback]);

  useEffect(() => () => {
    if (previousTimerRef.current) clearTimeout(previousTimerRef.current);
  }, []);

  if (!current || showFallback) return <FallbackScreen />;

  const key = `${current.id}-${retryTick}`;

  return (
    <>
      {previous && animations && (
        <MediaLayer key={`prev-${previous.id}`} media={previous} animationName={animations.exit} zIndex={1} />
      )}
      <MediaLayer
        key={key}
        media={current}
        animationName={animations?.enter ?? null}
        zIndex={2}
        onEnded={advance}
        onLoaded={handleLoaded}
        onError={handleError}
      />
    </>
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
function NewsTicker({ screenId, glass }: { screenId: string; glass: boolean }) {
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
    <Box sx={{ display: 'flex', alignItems: 'stretch', overflow: 'hidden', height: '100%' }}>
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
      <Box
        sx={{
          position: 'relative',
          flex: 1,
          overflow: 'hidden',
          ...(glass ? { bgcolor: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(14px)' } : { bgcolor: 'rgba(0,0,0,0.85)' }),
        }}
      >
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
 * il carosello a schermo intero, comportamento storico del modulo. Quando
 * attiva, il tema BLACK_WHITE divide lo schermo in tre fasce (il
 * carosello occupa solo l'area centrale), mentre GLASS lascia il
 * carosello a schermo intero e sovrappone le barre come overlay
 * semi-trasparenti e sfocate.
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
    () => ({ position: 'fixed' as const, inset: 0, bgcolor: 'black', overflow: 'hidden' as const }),
    [],
  );

  if (screenQuery.isLoading || screenQuery.isError || !screenQuery.data) {
    return (
      <Box sx={containerStyle}>
        <FallbackScreen />
      </Box>
    );
  }

  const data = screenQuery.data;

  if (!data.infoBar.enabled) {
    return (
      <Box sx={containerStyle}>
        <Carousel playlist={data.playlist} transitionEffect={data.transitionEffect} />
      </Box>
    );
  }

  const glass = data.infoBar.theme === 'GLASS';

  return (
    <Box sx={containerStyle}>
      <Box
        sx={{
          position: 'absolute',
          top: glass ? 0 : HEADER_HEIGHT,
          bottom: glass ? 0 : TICKER_HEIGHT,
          left: 0,
          right: 0,
        }}
      >
        <Carousel playlist={data.playlist} transitionEffect={data.transitionEffect} />
      </Box>

      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: HEADER_HEIGHT,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 3,
          zIndex: 3,
          ...(glass ? { bgcolor: 'rgba(15,23,42,0.35)', backdropFilter: 'blur(14px)' } : { bgcolor: 'rgba(0,0,0,0.85)' }),
        }}
      >
        <Typography variant="h5" fontWeight={700} sx={{ color: 'white' }}>
          {data.venueName}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {data.infoBar.weather && <WeatherWidget lat={data.infoBar.weather.lat} lng={data.infoBar.weather.lng} />}
          <LiveClock />
        </Box>
      </Box>

      <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: TICKER_HEIGHT, zIndex: 3 }}>
        <NewsTicker screenId={screenId!} glass={glass} />
      </Box>
    </Box>
  );
}
