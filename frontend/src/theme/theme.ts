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
