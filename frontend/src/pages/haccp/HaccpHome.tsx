import { TemperatureEntry } from './TemperatureEntry';

// In v1 la home del modulo HACCP coincide con l'inserimento temperature,
// il flusso più usato quotidianamente; report/firma restano lato backend
// (endpoint pronti) in attesa della UI dedicata (Fase 1 della roadmap).
export function HaccpHome() {
  return <TemperatureEntry />;
}
