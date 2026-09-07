/**
 * Tokens, types d'UI et formateurs partagés par les étapes de l'import
 * shapefile — extraits de page.tsx (2026-09-07), valeurs inchangées.
 */


export interface ColumnMapping {
  source: string;
  target: string; // user-chosen target name or '' for metadata
}

/** Étape courante du wizard : fichiers, mapping, import. */
export type WizardStep = 1 | 2 | 3;


// ─── Design tokens ────────────────────────────────────────────────────────────

export const C = {
  bg: 'var(--bg-primary)',
  bgElevated: 'var(--bg-surface)',
  bgSurface: 'var(--bg-level-2)',
  border: 'var(--border-subtle)',
  borderLight: 'var(--brand-teal-30)',
  accent: 'var(--brand-teal)',
  accentDim: 'var(--brand-teal-10)',
  text: 'var(--text-primary)',
  textDim: 'var(--text-secondary)',
  textSec: 'var(--text-tertiary)',
  muted: '#505050',
  green: 'var(--success)',
  greenDim: 'rgba(61,255,160,0.12)',
  red: '#f87171',
  redDim: 'rgba(248,113,113,0.1)',
  warn: '#fbbf24',
  warnDim: 'rgba(251,191,36,0.1)',
  blue: '#3b82f6',
};
export const fontMono = "'JetBrains Mono',monospace";
export const fontInter = "'Inter',system-ui,sans-serif";

// ─── Format helpers ──────────────────────────────────────────────────────────

// ─── Format helpers ──────────────────────────────────────────────────────────

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtTime(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec.toString().padStart(2, '0')}s`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString('fr-FR');
}
