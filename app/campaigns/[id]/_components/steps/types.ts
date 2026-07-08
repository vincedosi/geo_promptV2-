/**
 * GENESIS — Types & constantes partagées par les 4 étapes bespoke du
 * Programmer (Cible/Budget/Stratégie/Lancement) du cockpit campagne.
 *
 * Le brouillon (`ProgDraft`) vit dans `app/campaigns/[id]/page.tsx` et est
 * passé par référence à chaque étape — aucune étape ne persiste rien
 * elle-même avant Lancement (POST + PATCH réels vers /api/bidding/strategies).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { CibleZoneRef } from '@/lib/cibles/draft';
import type { CampaignChannels } from '@/lib/campaigns/channels';
import { EMPTY_CHANNELS } from '@/lib/campaigns/channels';

export type Intensity = 'doux' | 'marque' | 'fort';
export type ScopeType = 'national' | 'custom_zone';
export type ExecutionMode = 'monitor_only' | 'suggest' | 'auto';

export interface ProgDraft {
  intensity: Intensity;
  /** Panier de zones cibles (vide = national). Le zone_id final (directe ou composite) se calcule au Lancement. */
  cibles: CibleZoneRef[];
  /** Canaux déclarés (DSP/réseaux/ad server). Persistés au Lancement. */
  channels: CampaignChannels;
  totalBudget: number | null;
  forecastCpm: number | null;
  startDate: string; // 'YYYY-MM-DD' ou ''
  endDate: string;   // 'YYYY-MM-DD' ou ''
  executionMode: ExecutionMode;
}

export const DEFAULT_PROG_DRAFT: ProgDraft = {
  intensity: 'marque',
  cibles: [],
  channels: EMPTY_CHANNELS,
  totalBudget: null,
  forecastCpm: null,
  startDate: '',
  endDate: '',
  executionMode: 'auto',
};

export interface StepProps {
  draft: ProgDraft;
  setDraft: Dispatch<SetStateAction<ProgDraft>>;
}

/** La seule variable INSEE de ciblage disponible pour l'instant. */
export const TARGET_VARIABLE_CODE = 'abstention_pres_2022';

/** Courbes de pondération (x = taux d'abstention %, y = multiplicateur d'enchère). */
export const INTENSITY_CURVES: Record<Intensity, { x: number; y: number }[]> = {
  doux: [
    { x: 25, y: 0.8 },
    { x: 35, y: 1.4 },
  ],
  marque: [
    { x: 20, y: 0.5 },
    { x: 30, y: 1.0 },
    { x: 45, y: 2.2 },
  ],
  fort: [
    { x: 20, y: 0.3 },
    { x: 30, y: 1.0 },
    { x: 45, y: 3.0 },
  ],
};

export const INTENSITY_META: Record<Intensity, { title: string; sub: string }> = {
  doux: { title: 'Ciblage doux', sub: 'Sur-pondération légère des zones à forte abstention' },
  marque: { title: 'Ciblage marqué', sub: 'Réglage par défaut — bon compromis reach / focus' },
  fort: { title: 'Ciblage fort', sub: 'Concentre l’essentiel du budget sur les zones décrochées' },
};

/** Best-effort : retrouve le preset d'intensité depuis une courbe déjà enregistrée. */
export function inferIntensity(inZoneWeights: unknown): Intensity | null {
  const curve = (inZoneWeights as { curve?: { x: number; y: number }[] } | null | undefined)?.curve;
  if (!curve) return null;
  for (const key of Object.keys(INTENSITY_CURVES) as Intensity[]) {
    if (JSON.stringify(INTENSITY_CURVES[key]) === JSON.stringify(curve)) return key;
  }
  return null;
}

export const EXECUTION_MODE_META: Record<ExecutionMode, { title: string; sub: string }> = {
  monitor_only: { title: 'Observation', sub: 'L’agent regarde, ne touche à rien' },
  suggest: { title: 'Suggestion', sub: 'Il propose des ajustements, tu valides' },
  auto: { title: 'Automatique', sub: 'Il ajuste les enchères seul, dans tes garde-fous' },
};

export function fmtEUR(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('fr-FR') + ' €';
}

export function fmtDateShort(d: string): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
