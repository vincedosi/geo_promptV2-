/**
 * Tokens de style du FilterPanel — extraits tels quels du composant monolithe
 * (2026-09-03). Volontairement distincts de components/map/overlays/_shared/
 * styles.ts : les deux jeux ne mappent pas les mêmes variables CSS, les
 * fusionner changerait le rendu.
 */

export const C = {
  bg:        'var(--bg-primary)',
  bgPanel:   'var(--bg-surface)',
  bgInput:   'var(--bg-level-2)',
  border:    'var(--border-subtle)',
  text:      'var(--text-primary)',
  textSec:   'var(--text-secondary)',
  textDim:   'var(--text-tertiary)',
  green:     'var(--success)',
  greenDim:  'rgba(61,255,160,0.10)',
  amber:     'var(--warning)',
  amberDim:  'rgba(247,183,49,0.10)',
  red:       'var(--danger)',
  redDim:    'rgba(255,87,87,0.08)',
  redBorder: 'rgba(255,87,87,0.25)',
  muted:     'var(--text-tertiary)',
};
export const fInter    = "'Inter', system-ui, sans-serif";
export const fMono     = "'JetBrains Mono','Fira Mono',monospace";
