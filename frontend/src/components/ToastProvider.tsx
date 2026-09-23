import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Snackbar, Alert, type AlertColor } from '@mui/material';

interface ToastOptions {
  message: string;
  severity?: AlertColor;
}

type ShowToast = (options: ToastOptions | string) => void;

const ToastContext = createContext<ShowToast | null>(null);

/**
 * Notifica standard per un'azione conclusa (es. "Attività completata"):
 * appare in basso e si chiude da sola, invece di un Alert incorporato
 * nella pagina che resta lì finché non lo si chiude a mano. Un solo
 * Snackbar attivo alla volta: una nuova notifica sostituisce quella
 * ancora visibile.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; message: string; severity: AlertColor }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const showToast = useCallback<ShowToast>((options) => {
    const { message, severity = 'success' } =
      typeof options === 'string' ? { message: options, severity: undefined } : options;
    setState({ open: true, message, severity });
  }, []);

  const handleClose = () => setState((s) => ({ ...s, open: false }));

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <Snackbar
        open={state.open}
        autoHideDuration={4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleClose} severity={state.severity} variant="filled" sx={{ width: '100%' }}>
          {state.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

/** showToast('Fatto') oppure showToast({ message: 'Errore', severity: 'error' }). */
export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve essere usato dentro ToastProvider');
  return ctx;
}
