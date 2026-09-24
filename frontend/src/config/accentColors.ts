/**
 * Colori di accento selezionabili in Impostazioni > Tema: diventano il
 * colore primario del tema (barra in alto, pulsanti, icone della
 * navigazione laterale) e lo stesso "theme-color" della PWA — v.
 * theme/theme.ts e AppShell.tsx. L'admin può anche scegliere un colore
 * personalizzato al posto di uno di questi 5.
 */
export interface AccentColorPreset {
  label: string;
  value: string;
}

export const ACCENT_COLOR_PRESETS: AccentColorPreset[] = [
  { label: 'Petrolio', value: '#1E5F74' },
  { label: 'Bordeaux', value: '#8E3B46' },
  { label: 'Verde bosco', value: '#2F6E4F' },
  { label: 'Blu notte', value: '#2C3E70' },
  { label: 'Terracotta', value: '#C1622D' },
];

export const DEFAULT_ACCENT_COLOR = ACCENT_COLOR_PRESETS[0].value;
