import { createTheme, ThemeOptions } from '@mui/material/styles';

// Tema Material Design condiviso, con varianti chiara/scura.
// Colori scelti per essere neutri e adatti a un contesto ristorazione.
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
  },
};

export const lightTheme = createTheme({
  ...shared,
  palette: {
    mode: 'light',
    primary: { main: '#1E5F74' },
    secondary: { main: '#F2A541' },
    background: { default: '#F5F7F8', paper: '#FFFFFF' },
  },
});

export const darkTheme = createTheme({
  ...shared,
  palette: {
    mode: 'dark',
    primary: { main: '#4E9CB5' },
    secondary: { main: '#F2A541' },
    background: { default: '#101418', paper: '#181D22' },
  },
});
