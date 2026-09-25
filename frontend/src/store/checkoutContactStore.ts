import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Cache lato browser dei dati di contatto/consegna già inseriti al
 * checkout /ordina (§5.10 di DEVELOPMENT.md): nessun login, quindi niente
 * sessione server su cui appoggiarsi. Isolata per locale grazie al
 * sotto-dominio (origine diversa = localStorage diverso). Non contiene
 * MAI il carrello, i consensi o dati di pagamento — solo comodità, mai
 * usata per riproporre silenziosamente un consenso di una sessione
 * precedente.
 */
interface CheckoutContactState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  deliveryAddress: string;
  deliveryLat: number | null;
  deliveryLng: number | null;
  setContact: (data: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    deliveryAddress?: string;
    deliveryLat?: number | null;
    deliveryLng?: number | null;
  }) => void;
  clear: () => void;
}

const EMPTY_CONTACT = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  deliveryAddress: '',
  deliveryLat: null,
  deliveryLng: null,
} as const;

export const useCheckoutContactStore = create<CheckoutContactState>()(
  persist(
    (set) => ({
      ...EMPTY_CONTACT,
      setContact: (data) =>
        set({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          deliveryAddress: data.deliveryAddress ?? '',
          deliveryLat: data.deliveryLat ?? null,
          deliveryLng: data.deliveryLng ?? null,
        }),
      clear: () => set({ ...EMPTY_CONTACT }),
    }),
    { name: 'barmanager-order-contact' },
  ),
);
