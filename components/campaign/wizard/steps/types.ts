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
  /** Nom de la campagne — pré-rempli, persisté au Lancement (PATCH) s'il a changé. */
  name: string;
  /** Pression sur la cible : multiplicateur d'enchère max (×1 = uniforme, ×3 = concentration max). */
  pressure: number;
  /** Panier de zones cibles (vide = national). Le zone_id final (directe ou composite) se calcule au Lancement. */
  cibles: CibleZoneRef[];
  /** Canaux déclarés (DSP/réseaux/ad server). Persistés au Lancement. */
  channels: CampaignChannels;
  /** Une ligne de budget (€) par canal DSP/social sélectionné. Global = somme. */
  channelBudgets: Record<string, number>;
  forecastCpm: number | null;
  startDate: string; // 'YYYY-MM-DD' ou ''
  endDate: string;   // 'YYYY-MM-DD' ou ''
  executionMode: ExecutionMode;
}

export const DEFAULT_PROG_DRAFT: ProgDraft = {
  name: '',
  pressure: 2.2,
  cibles: [],
  channels: EMPTY_CHANNELS,
  channelBudgets: {},
  forecastCpm: null,
  startDate: '',
  endDate: '',
  executionMode: 'auto',
};

/** Budget global du brouillon = somme des lignes des canaux ENCORE sélectionnés (null si 0 — rien saisi). */
export function draftTotalBudget(d: ProgDraft): number | null {
  const allowed = new Set([...d.channels.dsps, ...d.channels.socials]);
  const sum = Object.entries(d.channelBudgets)
    .filter(([code]) => allowed.has(code))
    .reduce((s, [, v]) => s + (Number.isFinite(v) ? v : 0), 0);
  return sum > 0 ? Math.round(sum * 100) / 100 : null;
}

export interface StepProps {
  draft: ProgDraft;
  setDraft: Dispatch<SetStateAction<ProgDraft>>;
}

/** La seule variable INSEE de ciblage disponible pour l'instant. */
export const TARGET_VARIABLE_CODE = 'abstention_pres_2022';

/** Bornes de la pression sur la cible (multiplicateur d'enchère max). */
export const PRESSURE_MIN = 1;
export const PRESSURE_MAX = 3;
export const PRESSURE_STEP = 0.05;

export function clampPressure(m: number): number {
  if (!Number.isFinite(m)) return PRESSURE_MIN;
  return Math.min(PRESSURE_MAX, Math.max(PRESSURE_MIN, Math.round(m * 100) / 100));
}

/**
 * Courbe de pondération générée depuis la pression (x = taux d'abstention %,
 * y = multiplicateur d'enchère) : ×1/M sur les zones hors cible, ×1 au milieu,
 * ×M sur les zones les plus cibles. M=1 → pression uniforme.
 */
export function pressureCurve(m: number): { x: number; y: number }[] {
  const p = clampPressure(m);
  const lo = Math.round((1 / p) * 100) / 100;
  return [
    { x: 20, y: lo },
    { x: 30, y: 1.0 },
    { x: 45, y: p },
  ];
}

/** Best-effort : retrouve la pression (multiplicateur max) depuis une courbe déjà enregistrée. */
export function pressureFromCurve(inZoneWeights: unknown): number | null {
  const curve = (inZoneWeights as { curve?: { x: number; y: number }[] } | null | undefined)?.curve;
  if (!curve || curve.length === 0) return null;
  const max = Math.max(...curve.map((pt) => (typeof pt?.y === 'number' ? pt.y : 0)));
  if (!Number.isFinite(max) || max <= 0) return null;
  return clampPressure(max);
}

/** Compat : anciens presets « doux/marqué/fort » (chat IA, stratégies historiques). */
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

/** Compat : convertit un ancien preset d'intensité en pression numérique. */
export function intensityToPressure(i: Intensity): number {
  return clampPressure(Math.max(...INTENSITY_CURVES[i].map((pt) => pt.y)));
}

/** Format ×2,2 (fr-FR). */
export function fmtMult(m: number): string {
  return '×' + m.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
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
