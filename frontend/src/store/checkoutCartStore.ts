import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartLineModifier {
  id: string;
  name: string;
  price: number;
}

export interface CartLine {
  key: string;
  menuItemId: string;
  itemName: string;
  variantId: string;
  variantName: string;
  unitPrice: number;
  quantity: number;
  modifiers: CartLineModifier[];
  note: string;
}

interface CheckoutCartState {
  cart: CartLine[];
  setCart: (cart: CartLine[]) => void;
  clear: () => void;
}

/**
 * Cache lato browser del carrello del checkout pubblico /ordina (§5.10):
 * a differenza dei dati di contatto in checkoutContactStore, qui la
 * persistenza è voluta — un cliente che ricarica la pagina o torna più
 * tardi non deve ritrovarsi il carrello svuotato. Isolata per locale dal
 * sotto-dominio (origine diversa = localStorage diverso), come l'altro
 * store. Il pulsante "Svuota" nello step Carrello del checkout è la
 * controparte esplicita di questa persistenza.
 */
export const useCheckoutCartStore = create<CheckoutCartState>()(
  persist(
    (set) => ({
      cart: [],
      setCart: (cart) => set({ cart }),
      clear: () => set({ cart: [] }),
    }),
    { name: 'barmanager-order-cart' },
  ),
);
