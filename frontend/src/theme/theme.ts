import { createTheme, Theme, ThemeOptions } from '@mui/material/styles';
import { DEFAULT_ACCENT_COLOR } from '../config/accentColors';

// Tema Material Design condiviso. Solo il colore primario (accento) varia
// da locale a locale (v. Impostazioni > Tema, createAppTheme sotto): il
// resto — forma, tipografia, le eccezioni sui singoli componenti — resta
// identico per tutti.
const shared: ThemeOptions = {
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Roboto", "Segoe UI", sans-serif',
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    MuiCard: {
      styleOverrides: { root: { borderRadius: 16 } },
    },
    // MUI azzera in automatico il padding-top di DialogContent quando segue
    // subito un DialogTitle (regola interna ".MuiDialogTitle-root +
    // .MuiDialogContent-root", più specifica di qualunque sx locale come
    // "pt: 4" — motivo per cui quel workaround, sparso in ~18 pagine, non
    // ha mai davvero funzionato). Coi campi che occupano la prima riga
    // (select, date, ecc.), l'etichetta "shrink" sporge ~9px sopra il
    // proprio bordo: senza margine sopra viene tagliata dal contenitore,
    // che è scrollabile (overflow-y: auto). Ripristinato qui, una volta
    // per tutti i modali, lo stesso padding-top che DialogContent
    // avrebbe SENZA un DialogTitle prima (20px, il default MUI), con
    // "!important" per vincere la specificità di quella regola interna.
    MuiDialogContent: {
      styleOverrides: {
        root: { paddingTop: '20px !important' },
      },
    },
    // Le icone della navigazione laterale seguono il colore di accento del
    // locale (v. Impostazioni > Tema), non il grigio/nero di default delle
    // icone MUI: è l'unico punto che le imposta, valido per tutta l'app.
    MuiListItemIcon: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({ color: theme.palette.primary.main }),
      },
    },
  },
};

/**
 * Crea il tema con il colore di accento del locale (barra in alto,
 * pulsanti, icone della navigazione) — v. Impostazioni > Tema. Nessun
 * colore personalizzato impostato, o utente non loggato (pagine
 * pubbliche/login): usa il colore di default.
 */
export function createAppTheme(accentColor?: string | null) {
  return createTheme({
    ...shared,
    palette: {
      mode: 'light',
      primary: { main: accentColor || DEFAULT_ACCENT_COLOR },
      secondary: { main: '#F2A541' },
      background: { default: '#F5F7F8', paper: '#FFFFFF' },
    },
  });
}
