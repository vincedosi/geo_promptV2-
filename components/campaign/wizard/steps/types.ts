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
import type { CampaignChannels, DspLinks } from '@/lib/campaigns/channels';
import { EMPTY_CHANNELS } from '@/lib/campaigns/channels';

export type Intensity = 'doux' | 'marque' | 'fort';
export type ScopeType = 'national' | 'custom_zone';
export type ExecutionMode = 'monitor_only' | 'suggest' | 'auto';
/** Diffusion hors de la cible : coupée (zones strictes) ou France entière à la base ×1. */
export type Diffusion = 'zones_only' | 'national_boost';

export interface ProgDraft {
  /** Nom de la campagne — pré-rempli, persisté au Lancement (PATCH) s'il a changé. */
  name: string;
  /** Annonceur (marque) — identité déclarée, persistée au Lancement comme le nom. */
  advertiser: string;
  /** Produit/offre mis en avant — persisté au Lancement comme le nom. */
  product: string;
  /** Pression sur la cible : multiplicateur d'enchère max (×1 = uniforme, ×3 = concentration max). */
  pressure: number;
  /** Panier de zones cibles (vide = national). Le zone_id final (directe ou composite) se calcule au Lancement. */
  cibles: CibleZoneRef[];
  /** Variable INSEE choisie pour piloter la courbe de pression (code si plusieurs indicateurs; null sinon). */
  pressureVariable: string | null;
  /** Diffusion hors cible — ignorée si le panier est vide (national pur). */
  diffusion: Diffusion;
  /** Canaux déclarés (DSP/réseaux/ad server). Persistés au Lancement. */
  channels: CampaignChannels;
  /** Une ligne de budget (€) par canal DSP/social sélectionné. Global = somme. */
  channelBudgets: Record<string, number>;
  /** Liaison plateforme par provider (DV360 : annonceur → campagne → insertion order). */
  channelLinks: DspLinks;
  forecastCpm: number | null;
  startDate: string; // 'YYYY-MM-DD' ou ''
  endDate: string;   // 'YYYY-MM-DD' ou ''
  executionMode: ExecutionMode;
  /** Objectif d'optimisation (bidding_objectives.code). */
  objective: string;
  /** KPI cible chiffré, dans l'unité de l'objectif (null = pas de cible). */
  kpiTarget: number | null;
  /** Capping fréquence : X impressions / Y jours (les 2 requis, sinon ignoré). */
  freqCapImps: number | null;
  freqCapDays: number | null;
  /** Rythme de dépense. */
  pacing: 'even' | 'front_loaded' | 'back_loaded';
}

export const DEFAULT_PROG_DRAFT: ProgDraft = {
  name: '',
  advertiser: '',
  product: '',
  pressure: 2.2,
  cibles: [],
  pressureVariable: null,
  diffusion: 'zones_only',
  channels: EMPTY_CHANNELS,
  channelBudgets: {},
  channelLinks: {},
  forecastCpm: null,
  startDate: '',
  endDate: '',
  executionMode: 'auto',
  objective: 'maximize_leads',
  kpiTarget: null,
  freqCapImps: null,
  freqCapDays: null,
  pacing: 'even',
};

export const PACING_META: Record<'even' | 'front_loaded' | 'back_loaded', { title: string; sub: string }> = {
  even: { title: 'Régulier', sub: 'Dépense lissée sur toute la période' },
  front_loaded: { title: 'Départ fort', sub: 'Accélère au début, ralentit ensuite' },
  back_loaded: { title: 'Montée en puissance', sub: 'Démarre doucement, accélère vers la fin' },
};

/** Champs stratégie (POST/PATCH /api/bidding/strategies) portés par l'étape Stratégie. */
export function strategyFieldsFromDraft(d: ProgDraft): {
  objective_code: string; kpi_target: number | null;
  frequency_cap_imps: number | null; frequency_cap_period_days: number | null;
  pacing_strategy: 'even' | 'front_loaded' | 'back_loaded';
} {
  const capComplete = d.freqCapImps != null && d.freqCapImps > 0 && d.freqCapDays != null && d.freqCapDays > 0;
  return {
    objective_code: d.objective || 'maximize_leads',
    kpi_target: d.kpiTarget,
    frequency_cap_imps: capComplete ? d.freqCapImps : null,
    frequency_cap_period_days: capComplete ? d.freqCapDays : null,
    pacing_strategy: d.pacing,
  };
}

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

/** Empreinte canonique de la sélection canaux + liaisons — la coche de
 *  confirmation (étape Canaux) se réinitialise dès qu'elle change. */
export function linksSelectionHash(channels: CampaignChannels, links: DspLinks): string {
  const sortedLinks = Object.fromEntries(
    Object.entries(links)
      .filter(([, v]) => v && Object.keys(v).length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, Object.fromEntries(Object.entries(v ?? {}).sort(([a], [b]) => a.localeCompare(b)))]),
  );
  return JSON.stringify({
    d: [...channels.dsps].sort(),
    s: [...channels.socials].sort(),
    a: channels.ad_server,
    l: sortedLinks,
  });
}


/** Bornes de la pression sur la cible (multiplicateur d'enchère max). */
export const PRESSURE_MIN = 1;
export const PRESSURE_MAX = 3;
export const PRESSURE_STEP = 0.05;

export function clampPressure(m: number): number {
  if (!Number.isFinite(m)) return PRESSURE_MIN;
  return Math.min(PRESSURE_MAX, Math.max(PRESSURE_MIN, Math.round(m * 100) / 100));
}

/**
 * Courbe de pondération générée depuis la pression (x = valeur de l'indicateur (domaine paramétré),
 * y = multiplicateur d'enchère) : ×1/M sur les CP les moins cibles, ×1 au milieu,
 * ×M sur les CP les plus cibles. M=1 → pression uniforme.
 *
 * `floor` (optionnel) borne le bas de la courbe : en diffusion nationale avec
 * surpression, le hors-zone est à ×1 — sans floor, le bas de la cible
 * enchérirait MOINS que le hors-zone (incohérent). floor=1 → courbe ×1 → ×M.
 *
 * `domain` (optionnel) : bornes de l'indicateur. Par défaut : [10, 60] (abstention).
 * x calculé comme : min + frac * (max - min).
 */
export function pressureCurve(
  m: number,
  floor?: number,
  domain?: { min: number; max: number },
): { x: number; y: number }[] {
  const p = clampPressure(m);
  const lo = Math.round((1 / p) * 100) / 100;
  const f = (y: number) => (floor != null ? Math.max(floor, y) : y);
  const { min, max } = domain ?? { min: 10, max: 60 }; // défaut = bornes registre abstention
  const range = max - min;
  const x = (frac: number) => Math.round((min + frac * range) * 100) / 100;
  return [
    { x: x(0.2), y: f(lo) },
    { x: x(0.4), y: f(1.0) },
    { x: x(0.7), y: f(p) },
  ];
}

/** Indicateurs distincts portés par le panier de cibles (ordre du panier). */
export function resolvePressureIndicators(
  cibles: CibleZoneRef[],
): Array<{ code: string; label: string; min: number; max: number }> {
  const seen = new Set<string>();
  const out: Array<{ code: string; label: string; min: number; max: number }> = [];
  for (const c of cibles) {
    if (c.indicator && !seen.has(c.indicator.code)) {
      seen.add(c.indicator.code);
      out.push(c.indicator);
    }
  }
  return out;
}

/**
 * `out_zone_weights` de la stratégie selon la diffusion choisie.
 * Sans zone cible (national pur), la notion n'existe pas → {}.
 */
export function diffusionOutZoneWeights(
  diffusion: Diffusion,
  hasZones: boolean,
): Record<string, unknown> {
  if (!hasZones) return {};
  return diffusion === 'zones_only'
    ? { mode: 'exclusion' }
    : { mode: 'uniform', value: 1.0 };
}

/** Floor de la courbe de pression selon la diffusion (voir pressureCurve). */
export function diffusionCurveFloor(diffusion: Diffusion, hasZones: boolean): number | undefined {
  return hasZones && diffusion === 'national_boost' ? 1.0 : undefined;
}

/** in_zone_weights de la stratégie : courbe sur l'indicateur de la cible,
 *  uniforme si la cible n'a pas d'indicateur, abstention en national pur (historique). */
export function buildInZoneWeights(d: ProgDraft): Record<string, unknown> {
  const hasZones = d.cibles.length > 0;
  const floor = diffusionCurveFloor(d.diffusion, hasZones);
  const indicators = resolvePressureIndicators(d.cibles);
  const chosen = indicators.find((i) => i.code === d.pressureVariable) ?? indicators[0] ?? null;
  if (hasZones && !chosen) {
    return { mode: 'uniform', value: clampPressure(d.pressure) };
  }
  const variable = chosen ?? { code: 'abstention_pres_2022', label: '', min: 10, max: 60 };
  return {
    mode: 'by_insee_variable',
    variable_code: variable.code,
    curve: pressureCurve(d.pressure, floor, { min: variable.min, max: variable.max }),
  };
}

/**
 * Stratégie utilisable pour les téléchargements custom bidding (étape
 * Lancement) : celle créée dans le montage courant, sinon la stratégie
 * existante si elle est déjà active — l'état local ne survit pas aux
 * allers-retours entre étapes du wizard.
 */
export function resolveDownloadStrategyId(
  armedId: string | null,
  existingId: string | null,
  existingActive: boolean,
): string | null {
  return armedId ?? (existingActive ? existingId : null);
}

export const DIFFUSION_META: Record<Diffusion, { title: string; sub: string; recap: string }> = {
  zones_only: {
    title: 'Zones strictes',
    sub: 'Diffusion coupée hors de tes zones (×0) — tout le budget reste sur la cible',
    recap: 'zones strictes',
  },
  national_boost: {
    title: 'National avec surpression',
    sub: 'Toute la France à la base ×1, tes zones boostées jusqu’au multiplicateur choisi',
    recap: 'national + surpression',
  },
};

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
