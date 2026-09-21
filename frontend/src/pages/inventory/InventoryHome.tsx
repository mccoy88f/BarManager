import { NewOrder } from './NewOrder';

// Home del modulo inventario: v1 espone direttamente il flusso "nuovo
// ordine"; le schermate di gestione categorie/prodotti/fornitori usano
// gli stessi endpoint REST e vanno aggiunte nella Fase 1 della roadmap.
export function InventoryHome() {
  return <NewOrder />;
}
