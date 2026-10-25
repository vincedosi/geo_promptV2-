/**
 * ⑥ Plan — le PRÉREMPLISSAGE du brouillon (lot 6, T2), logique pure : les trois `setDraft((prev) => …)` du wizard
 * React, chacun ne remplissant que ce qui est vide — la campagne (`CampaignCockpit.tsx:89-100`), la stratégie
 * existante (`CampaignCockpit.tsx:104-126`), les canaux stockés (`StepCanaux.tsx:91-105`). `PlanCampagneService` les
 * enchaîne dans cet ordre, puis le brouillon serveur prime (règle `restoredAppliedRef`).
 *
 * Écarts à React, tous hors V1 (spec § 19) : la stratégie ne repréremplit ni `pressure` (courbe d'enchère, non portée)
 * ni `cibles` (panier de zones, A-9) ; ils gardent leur valeur. Les canaux remplissent aussi `cpmPrevus` (A-10).
 */
import type { ProgDraft } from './brouillon';
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

/** CPM, dates et mode d'exécution d'une stratégie déjà enregistrée (re-programmation) : ils écrasent, comme React. */
export function remplirDepuisStrategie(d: ProgDraft, s: StrategieLue): ProgDraft {
  return {
    ...d,
    forecastCpm: s.forecast_cpm ?? d.forecastCpm,
    startDate: s.start_date ? jour(s.start_date) : d.startDate,
    endDate: s.end_date ? jour(s.end_date) : d.endDate,
    executionMode: s.execution_mode ?? d.executionMode,
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
