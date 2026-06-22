/** MAGELIAN — constantes de l'onglet API (providers + tokens design). */
import type { DspProvider } from '@/types/dsp';

export interface ProviderMeta {
  key: DspProvider;
  label: string;
  logo: string;
  available: boolean; // false = placeholder « bientôt disponible »
}

export const PROVIDERS: ProviderMeta[] = [
  { key: 'dv360',  label: 'DV360',          logo: '/logos/dv360.svg',  available: true },
  { key: 'meta',   label: 'Meta',           logo: '/logos/meta.svg',   available: false },
  { key: 'tiktok', label: 'TikTok',         logo: '/logos/tiktok.svg', available: false },
  { key: 'ttd',    label: 'The Trade Desk', logo: '/logos/ttd.svg',    available: false },
];

/** Tokens design réutilisés (var(--…) du design system, jamais de hex en dur). */
export const C = {
  bg: 'var(--bg-primary)',
  card: 'var(--bg-surface)',
  elevated: 'var(--bg-level-2)',
  border: 'var(--border-subtle)',
  borderDefault: 'var(--border-default)',
  teal: 'var(--brand-teal)',
  green: 'var(--success)',
  red: 'var(--danger)',
  warn: 'var(--warning)',
  text: 'var(--text-primary)',
  textSec: 'var(--text-secondary)',
  textDim: 'var(--text-tertiary)',
};
export const fInter = "'Inter', system-ui, sans-serif";
export const fMono = "'JetBrains Mono', monospace";
