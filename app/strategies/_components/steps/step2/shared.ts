/**
 * Types, tokens et helpers partagés par les blocs de l'étape 2 du wizard de
 * stratégie (Périmètre + Pondération) — extraits de Step2Geography.tsx
 * (2026-09-08), valeurs inchangées.
 */

import type { Tier, WeightingMode } from '@/lib/strategy-wizard/types';

/** Réponse de `/api/custom-geo/list` — une zone custom de l'organisation. */
export interface ZoneSummary {
  id: string;
  name: string;
  source_type: string;
  feature_count_cp: number;
  feature_count_iris: number;
  bbox?: [number, number, number, number] | null;
}

/** Métadonnées d'une variable INSEE de pondération (`/api/insee-variables/list`). */
export interface InseeVariableMeta {
  code: string;
  label_fr: string;
  category: string;
  description_fr: string;
  unit: string;
  icon: string;
  source: string;
  source_year: number;
  min: number;
  max: number;
  median: number;
  n_cps: number;
}

/** Détail d'une zone custom avec ses sous-zones natives (`/api/custom-geo/[id]`). */
export interface ZoneDetail {
  id: string;
  name: string;
  source_type: string;
  bbox: [number, number, number, number] | null;
  feature_count_iris: number;
  feature_count_cp: number;
  subzones: Array<{
    id: string;
    name: string;
    source_ref: string | null;
    ordering: number;
    default_multiplier: number;
    cp_count: number;
    iris_count: number;
  }>;
}

export const TIERS: Tier[] = ['premium_urban', 'urban', 'suburban', 'rural'];

export const TIER_DOT: Record<Tier, string> = {
  premium_urban: '#4ecdc4',
  urban: '#7dd3c0',
  suburban: '#f7b731',
  rural: '#a0a0a0',
};

export const inputCls = 'bg-bg-level-2 border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-teal/50';
export const selectCls = 'w-full bg-bg-level-2 border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-teal/50';

export function pillCls(active: boolean) {
  return `px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
    active
      ? 'border-accent-teal/50 bg-bg-level-2 text-text-primary'
      : 'border-border-subtle bg-bg-level-1 text-text-secondary hover:border-border-hover hover:text-text-primary'
  }`;
}

export function modeLabel(m: WeightingMode): string {
  if (m === 'uniform') return 'Uniforme';
  if (m === 'by_tier') return 'Par tier';
  if (m === 'by_subzone') return 'Par sous-zone';
  if (m === 'by_cp_csv') return 'CSV par CP';
  if (m === 'by_insee_variable') return 'Par variable INSEE';
  return m;
}
