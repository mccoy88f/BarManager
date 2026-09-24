import { useEffect, useMemo } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { createAppTheme } from '../theme/theme';
import { DEFAULT_ACCENT_COLOR } from '../config/accentColors';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client';

/**
 * Applica il colore di accento del locale (v. Impostazioni > Tema) a tutta
 * l'app: stessa query "venue-me" già usata da AppShell per il nome del
 * locale (react-query la deduplica per chiave, nessuna richiesta doppia),
 * così Admin/Manager vedono il colore aggiornato in tempo reale dopo un
 * cambio in Impostazioni, non solo quello letto al login. Per
 * Dipendente/Super Admin (a cui l'endpoint non è comunque accessibile) o
 * per chi non ha ancora fatto login (pagine pubbliche/login) resta il
 * valore letto al login (cache locale) o il colore di default.
 */
export function DynamicThemeProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const cachedAccentColor = useAuthStore((s) => s.themeAccentColor);

  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<{ name: string; themeAccentColor: string | null }>('/venues/me')).data,
    enabled: user?.role === 'ADMIN' || user?.role === 'MANAGER',
    staleTime: 60_000,
  });

  const accentColor = venueQuery.data?.themeAccentColor ?? cachedAccentColor;
  const theme = useMemo(() => createAppTheme(accentColor), [accentColor]);

  // "Barra in alto" del browser/PWA installata: molti browser (Chrome/Edge
  // su Android, incluso in modalità standalone) rileggono questo meta tag
  // dal vivo, quindi aggiornarlo qui basta per farla seguire l'accento —
  // senza bisogno di reinstallare la PWA. Il colore statico nel manifest
  // (usato solo dalla schermata di installazione, che non ha alcun contesto
  // di locale) resta invece quello di default: non è raggiungibile da qui.
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', accentColor || DEFAULT_ACCENT_COLOR);
  }, [accentColor]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
