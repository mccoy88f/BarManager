import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Typography } from '@mui/material';
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

const DEFAULT_PHOTO_SECONDS = 8;
// Non critico in tempo reale come gli ordini online: un minuto di ritardo
// nel recepire una modifica dal gestionale è accettabile per uno schermo
// pubblicitario, e tiene il traffico di polling basso su schermi sempre
// accesi (§5.12 di DEVELOPMENT.md).
const POLL_INTERVAL_MS = 60000;

/** Firma leggera per sapere se la playlist attiva è cambiata (nuova playlist O contenuti riordinati/aggiunti dentro la stessa). */
function playlistSignature(playlist: DisplayPromoPlaylist | null | undefined): string {
  if (!playlist) return '';
  return `${playlist.id}:${playlist.items.map((i) => i.id).join(',')}`;
}

/**
 * Pagina pubblica /display/:screenId (§5.12 di DEVELOPMENT.md): a tutto
 * schermo, per TV/tablet collegati in loop (orizzontali o verticali,
 * nessun vincolo di orientamento lato pagina — il layout si adatta al
 * viewport del dispositivo). Nessun login; a differenza delle altre
 * pagine pubbliche l'id dello schermo identifica già il locale, non serve
 * sottodominio/`?venueSlug=` — ogni display ha il proprio link/QR
 * (DisplayPromoAdmin.tsx), dato che un locale può averne più di uno.
 */
export function PublicDisplayPromo() {
  const { screenId } = useParams<{ screenId: string }>();
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playlistQuery = useQuery({
    queryKey: ['public-display-promo', screenId],
    queryFn: async () => (await api.get<DisplayPromoPlaylist | null>(`/public/display-promo/${screenId}`)).data,
    enabled: !!screenId,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const items = playlistQuery.data?.items ?? [];
  const signature = playlistSignature(playlistQuery.data);

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

  const containerStyle = useMemo(
    () =>
      ({
        position: 'fixed' as const,
        inset: 0,
        bgcolor: 'black',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }) as const,
    [],
  );

  if (playlistQuery.isLoading) {
    return <Box sx={containerStyle} />;
  }

  if (!current) {
    return (
      <Box sx={containerStyle}>
        <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.4)' }}>
          {playlistQuery.isError ? 'Display non disponibile.' : ''}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={containerStyle}>
      {current.type === 'VIDEO' ? (
        <video
          key={current.id}
          src={current.url}
          autoPlay
          muted
          playsInline
          onEnded={advance}
          onError={advance}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Box
          key={current.id}
          component="img"
          src={current.url}
          onError={advance}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </Box>
  );
}
