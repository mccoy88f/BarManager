import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * React Router non riporta la pagina in cima ad ogni navigazione (a
 * differenza di una normale navigazione browser): senza questo, una nuova
 * pagina apribile mentre la precedente era scrollata in basso restava
 * scrollata a quel punto, apparendo "aperta più in basso" invece che dalla
 * cima. Nessun contenuto da renderizzare: solo l'effetto collaterale.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
