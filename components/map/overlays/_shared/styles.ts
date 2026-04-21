// Tokens partagés entre les sub-overlays — remplacent les constantes internes
// du FilterPanel original (C.*, fInter) lors de la migration du JSX.

export const FONTS = {
  inter: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Fira Mono', monospace",
} as const;

export const COLORS = {
  border: 'var(--border-subtle)',
  borderDefault: 'var(--border-default)',
  borderHover: 'var(--border-hover)',
  bgPanel: 'var(--card)',
  bgSurface: 'var(--bg-surface)',
  bgLevel2: 'var(--bg-level-2)',
  bgLevel3: 'var(--bg-level-3)',
  text: 'var(--text-primary)',
  textDim: 'var(--text-secondary)',
  textTertiary: 'var(--text-tertiary)',
  brand: 'var(--brand-teal)',
  brandHover: 'var(--brand-teal-hover)',
  red: 'var(--danger)',
  green: 'var(--success)',
  amber: 'var(--warning)',
} as const;
