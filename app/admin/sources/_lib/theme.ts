/**
 * MAGELIAN — jetons de style et constantes du back-office Data Sources.
 *
 * Extraits de app/admin/sources/page.tsx (refactor du 31/08/2026).
 *
 * Toutes les couleurs pointent sur des variables CSS du DESIGN_SYSTEM :
 * jamais de hex en dur ici. Les deux exceptions (`greenDim`, `redDim`,
 * `warnDim`, `blue`) sont conservees telles quelles depuis l'original — a
 * migrer vers des tokens quand le design system exposera les variantes
 * transparentes.
 */

export const C = {
  bg:          'var(--bg-primary)',
  bgElevated:  'var(--bg-surface)',
  bgSurface:   'var(--bg-level-2)',
  border:      'var(--border-subtle)',
  borderLight: 'var(--brand-teal-30)',
  accent:      'var(--brand-teal)',
  accentDim:   'var(--brand-teal-10)',
  text:        'var(--text-primary)',
  textDim:     'var(--text-secondary)',
  textSec:     'var(--text-tertiary)',
  muted:       'var(--text-tertiary)',
  green:       'var(--success)',
  greenDim:    'rgba(61,255,160,0.10)',
  red:         'var(--danger)',
  redDim:      'rgba(255,87,87,0.1)',
  warn:        'var(--warning)',
  warnDim:     'rgba(247,183,49,0.1)',
  blue:        '#5b9bd5',
};

export const fontMono  = "'JetBrains Mono', monospace";
export const fontInter = "'Inter', system-ui, sans-serif";

/** Colonnes de schema exploitables comme filtres carte (hors id/lat/lng/geom). */
export const SCHEMA_FILTER_COLS = [
  'region', 'departement', 'ville', 'code_postal', 'categorie', 'sous_categorie',
];
