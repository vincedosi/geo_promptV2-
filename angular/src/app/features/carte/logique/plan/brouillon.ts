/**
 * ⑥ Plan — le BROUILLON de campagne (`ProgDraft`), copié de `components/campaign/wizard/steps/types.ts` et de
 * `wizard/useDraftAutosave.ts` (lot 6, T2, A-2), réduit à ce que la V1 lit (spec § 19).
 *
 * La FORME est celle de React, champ pour champ : un brouillon serveur (`bidding_strategy_drafts`) repris d'un côté se
 * rouvre de l'autre. ⑥ n'édite pas les champs hors V1 (`pressure`, `cibles`, `pressureVariable`, `diffusion`,
 * `objective`, `kpiTarget`, `freqCap*`, `pacing`, `executionMode`) : il les garde à leur valeur lue. Angular ajoute
 * deux champs FACULTATIFS, ignorés par React : `cpmPrevus` (A-10) et `jeuZones.extraction` (A-3).
 *
 * Non copiés (hors V1) : la courbe de pression, la diffusion, `strategyFieldsFromDraft`, `resolveDownloadStrategyId`,
 * les `*_META`, `fmtMult`. Verrouillée par `tests/unit/angular/plan-logique-paritaire.test.ts`.
 */
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { type CampaignChannels, EMPTY_CHANNELS } from './canaux';
import type { DspLinks } from './liens-plateformes';

export type ExecutionMode = 'monitor_only' | 'suggest' | 'auto';
/** Diffusion hors de la cible : coupée (zones strictes) ou France entière à la base ×1. */
export type Diffusion = 'zones_only' | 'national_boost';

/** Une zone du panier de cibles de React (`lib/cibles/draft.ts`) : gardée telle quelle, jamais éditée en V1. */
export interface CibleZoneRef {
  id: string;
  name: string;
  sourceType: string;
  indicator?: { code: string; label: string; min: number; max: number };
  population?: number | null;
}

/** Le jeu de zones choisi comme plan ; `extraction` (Angular seul) : la version figée qui sera rattachée (A-3). */
export interface JeuDuPlan {
  id: string;
  nom: string;
  version: number;
  extraction?: { id: string; version: number };
}

export interface ProgDraft {
  /** Nom de la campagne — pré-rempli, persisté au Lancement (PATCH) s'il a changé. */
  name: string;
  /** Annonceur (marque) — identité déclarée, persistée au Lancement comme le nom. */
  advertiser: string;
  /** Produit/offre mis en avant — persisté au Lancement comme le nom. */
  product: string;
  /** Hors V1 : multiplicateur d'enchère max. */
  pressure: number;
  /** Hors V1 : panier de zones cibles. */
  cibles: CibleZoneRef[];
  /** Hors V1 : variable INSEE de la courbe de pression. */
  pressureVariable: string | null;
  /** Le jeu de zones choisi comme PLAN géographique (seule source de la V1, A-9). */
  jeuZones: JeuDuPlan | null;
  /** Hors V1 : diffusion hors cible. */
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
  /** Hors V1 (Stratégie, Q-2). */
  executionMode: ExecutionMode;
  objective: string;
  kpiTarget: number | null;
  freqCapImps: number | null;
  freqCapDays: number | null;
  pacing: 'even' | 'front_loaded' | 'back_loaded';
  /** Angular seul (A-10) : CPM prévu (€) par canal DSP/social. Absent d'un brouillon écrit par React. */
  cpmPrevus?: Record<string, number>;
}

export const DEFAULT_PROG_DRAFT: ProgDraft = {
  name: '',
  advertiser: '',
  product: '',
  pressure: 2.2,
  cibles: [],
  pressureVariable: null,
  jeuZones: null,
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

/** Budget global du brouillon = somme des lignes des canaux ENCORE sélectionnés (null si 0 — rien saisi). */
export function draftTotalBudget(d: ProgDraft): number | null {
  const allowed = new Set([...d.channels.dsps, ...d.channels.socials]);
  const sum = Object.entries(d.channelBudgets)
    .filter(([code]) => allowed.has(code))
    .reduce((s, [, v]) => s + (Number.isFinite(v) ? v : 0), 0);
  return sum > 0 ? Math.round(sum * 100) / 100 : null;
}

/**
 * Empreinte canonique de la sélection canaux + liaisons — la coche de confirmation se réinitialise dès qu'elle
 * change.
 */
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

/** Le brouillon tel que `bidding_strategy_drafts.draft_data` le stocke (format de React, version 1). */
export function serializeDraft(d: ProgDraft): Record<string, unknown> {
  return { v: 1, draft: d };
}

/** Relit un brouillon serveur ; un format inconnu → `null` (on repart du défaut). Les champs absents gardent leur défaut. */
export function deserializeDraft(raw: unknown): ProgDraft | null {
  const data = raw as { v?: number; draft?: Record<string, unknown> } | null;
  if (!data || data.v !== 1 || !data.draft || typeof data.draft !== 'object') return null;
  return { ...DEFAULT_PROG_DRAFT, ...(data.draft as Partial<ProgDraft>) };
}

/** Montant en euros, séparateurs français (`fmtEUR` de React) ; `—` sans valeur. */
export function fmtEUR(n: number | null): string {
  if (n == null) return '—';
  return formaterNombre(n) + ' €';
}

/**
 * Un CPM en euros à deux décimales, « 7,25 € » ; `—` sans valeur. Angular seul (A-10, React n'a pas de CPM par
 * plateforme) : une seule écriture pour la section Impressions, le bandeau et le pied (revue finale, F-3).
 */
export function fmtCpm(n: number | null): string {
  return n == null ? '—' : `${formaterDecimal(n, 2)} €`;
}

/** Date courte `jj/mm/aa` (`fmtDateShort` de React) ; `—` vide ou illisible. */
export function fmtDateShort(d: string): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
