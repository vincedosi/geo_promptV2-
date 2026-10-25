/**
 * ⑥ Plan — le PRÉREMPLISSAGE du brouillon (lot 6, T2), logique pure : les trois `setDraft((prev) => …)` du wizard
 * React, chacun ne remplissant que ce qui est vide — la campagne (`CampaignCockpit.tsx:89-100`), la stratégie
 * existante (`CampaignCockpit.tsx:104-126`), les canaux stockés (`StepCanaux.tsx:91-105`). `PlanCampagneService` les
 * enchaîne dans cet ordre, puis le brouillon serveur prime (règle `restoredAppliedRef`).
 *
 * Écarts à React, tous hors V1 (spec § 19) : la stratégie ne repréremplit ni `pressure` (courbe d'enchère, non portée)
 * ni `cibles` (panier de zones, A-9) ; ils gardent leur valeur. Les canaux remplissent aussi `cpmPrevus` (A-10).
 * Écart de fond (revue finale, I-1) : la stratégie d'une campagne LANCÉE rend sa cible — le jeu et l'extraction que
 * `rattacher` a écrits dans `in_zone_weights` (`lib/zones/plan-extraction.ts`). React ne restaure pas `jeuZones` ;
 * sans elle, une campagne lancée rouverte (le lancement jette le brouillon serveur) n'avait plus de cible.
 */
import type { JeuDuPlan, ProgDraft } from './brouillon';
import type { StoredChannels } from './canaux';

/** Ce qu'il faut d'une campagne pour préremplir (`dsp_campaigns`). */
export interface IdentiteCampagne {
  name: string;
  advertiser: string | null;
  product: string | null;
  date_start: string | null;
  date_end: string | null;
}

/** Ce qu'il faut d'une stratégie existante (`bidding_strategies`). */
export interface StrategieLue {
  forecast_cpm: number | null;
  start_date: string | null;
  end_date: string | null;
  execution_mode: ProgDraft['executionMode'] | null;
  /** La SOURCE du plan écrite par `rattacher` ; seul le mode `zone_set` avec extraction est relu. */
  in_zone_weights?: Record<string, unknown> | null;
}

const jour = (d: string | null) => (d ? d.slice(0, 10) : '');

/** Nom, annonceur, produit et dates de la campagne, là où le brouillon n'en a pas. */
export function remplirIdentite(d: ProgDraft, c: IdentiteCampagne): ProgDraft {
  return {
    ...d,
    name: d.name || c.name || '',
    advertiser: d.advertiser || c.advertiser || '',
    product: d.product || c.product || '',
    startDate: d.startDate || jour(c.date_start),
    endDate: d.endDate || jour(c.date_end),
  };
}

/**
 * CPM, dates et mode d'exécution d'une stratégie déjà enregistrée (re-programmation) : ils écrasent, comme React. La
 * cible aussi, quand la stratégie vient d'une extraction (I-1) ; le brouillon serveur, relu APRÈS, garde la priorité.
 */
export function remplirDepuisStrategie(d: ProgDraft, s: StrategieLue): ProgDraft {
  return {
    ...d,
    forecastCpm: s.forecast_cpm ?? d.forecastCpm,
    startDate: s.start_date ? jour(s.start_date) : d.startDate,
    endDate: s.end_date ? jour(s.end_date) : d.endDate,
    executionMode: s.execution_mode ?? d.executionMode,
    jeuZones: cibleDeStrategie(s.in_zone_weights) ?? d.jeuZones,
  };
}

/**
 * Le jeu et l'extraction d'un plan rattaché depuis une extraction (`source` de `planExtraction` : `mode: 'zone_set'`,
 * `zone_set_id`, `zone_set_nom`, `zone_set_version`, `extraction_id`, `extraction_version`). Le chemin vivant de
 * `rattacher` (sans extraction) et les autres modes rendent `null` : ⑥ ne cible qu'une extraction (A-9).
 */
export function cibleDeStrategie(source: Record<string, unknown> | null | undefined): JeuDuPlan | null {
  if (!source || source['mode'] !== 'zone_set') return null;
  const { zone_set_id: id, zone_set_nom: nom, zone_set_version: version, extraction_id: xId, extraction_version: xVersion } = source;
  if (typeof id !== 'string' || typeof xId !== 'string' || typeof xVersion !== 'number') return null;
  return {
    id,
    nom: typeof nom === 'string' ? nom : '',
    version: typeof version === 'number' ? version : 0,
    extraction: { id: xId, version: xVersion },
  };
}

/** Canaux, budgets, liaisons et CPM stockés sur la campagne, pour chaque sous-clé encore VIDE du brouillon. */
export function remplirCanaux(d: ProgDraft, s: StoredChannels | null | undefined): ProgDraft {
  const vides = {
    canaux: d.channels.dsps.length === 0 && d.channels.socials.length === 0 && d.channels.ad_server === null,
    budgets: Object.keys(d.channelBudgets).length === 0,
    liens: Object.keys(d.channelLinks).length === 0,
    cpm: Object.keys(d.cpmPrevus ?? {}).length === 0,
  };
  if (!s || !Object.values(vides).some(Boolean)) return d;
  return {
    ...d,
    channels: vides.canaux ? { dsps: s.dsps ?? [], socials: s.socials ?? [], ad_server: s.ad_server ?? null } : d.channels,
    channelBudgets: vides.budgets ? { ...(s.budgets ?? {}) } : d.channelBudgets,
    channelLinks: vides.liens ? { ...(s.links ?? {}) } : d.channelLinks,
    cpmPrevus: vides.cpm ? { ...(s.cpm_prevus ?? {}) } : d.cpmPrevus,
  };
}
