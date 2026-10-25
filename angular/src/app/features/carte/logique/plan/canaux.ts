/**
 * ⑥ Plan — les canaux d'une campagne (DSP / réseaux sociaux / ad server), copiés de `lib/campaigns/channels.ts`
 * (lot 6, T2). Le catalogue vient de `dsp_channel_registry`, le « connecté » de `dsp_connections`. Les schémas Zod
 * restent au serveur. Verrouillée par `tests/unit/angular/plan-logique-paritaire.test.ts`.
 */
import type { DspLinks, LinkLevel } from './liens-plateformes';

export type ChannelCategory = 'dsp' | 'social' | 'adserver';

export interface ChannelRow {
  code: string;
  label: string;
  category: ChannelCategory;
  connection_provider: string | null;
  active: boolean;
  /** Niveaux de liaison plateforme du registre (cascade API ou saisie manuelle). */
  link_levels?: LinkLevel[] | null;
}

export interface CampaignChannels {
  dsps: string[];
  socials: string[];
  ad_server: string | null;
}

export const EMPTY_CHANNELS: CampaignChannels = { dsps: [], socials: [], ad_server: null };

export interface ResolvedChannel extends ChannelRow { available: boolean; connected: boolean }

export function resolveChannelAvailability(
  registry: ChannelRow[], connectedProviders: string[], isDemo: boolean,
): ResolvedChannel[] {
  return registry
    .filter((r) => r.active)
    .map((r) => {
      const connected = !!r.connection_provider && connectedProviders.includes(r.connection_provider);
      return { ...r, connected, available: isDemo || connected };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

export function validateSelection(
  sel: CampaignChannels, registry: ChannelRow[], connectedProviders: string[], isDemo: boolean,
): { ok: true } | { ok: false; badCode: string } {
  const resolved = resolveChannelAvailability(registry, connectedProviders, isDemo);
  const byCode = new Map(resolved.map((r) => [r.code, r]));
  const check = (code: string, cat: ChannelCategory) => {
    const r = byCode.get(code);
    return !!r && r.category === cat && r.available;
  };
  for (const c of sel.dsps) if (!check(c, 'dsp')) return { ok: false, badCode: c };
  for (const c of sel.socials) if (!check(c, 'social')) return { ok: false, badCode: c };
  if (sel.ad_server !== null && !check(sel.ad_server, 'adserver')) return { ok: false, badCode: sel.ad_server };
  return { ok: true };
}

/** Une ligne (€) par canal DSP/social sélectionné : budgets, et CPM prévus (A-10). Global = somme. */
export type ChannelBudgets = Record<string, number>;

/** Forme complète stockée dans `geo_strategy.channels`. */
export interface StoredChannels extends CampaignChannels {
  budgets?: ChannelBudgets;
  /** CPM prévu (€) par canal (lot 6, A-10) : même forme, même élagage que `budgets`. */
  cpm_prevus?: ChannelBudgets;
  links?: DspLinks;
}

/** Somme des lignes budget (0 si vide/absent). */
export function sumBudgets(budgets: ChannelBudgets | null | undefined): number {
  return Object.values(budgets ?? {}).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
}

/** Garde uniquement les lignes des canaux encore sélectionnés (purge au retrait). */
export function pruneBudgets(
  budgets: ChannelBudgets | null | undefined, sel: CampaignChannels,
): ChannelBudgets {
  const allowed = new Set([...sel.dsps, ...sel.socials]);
  return Object.fromEntries(Object.entries(budgets ?? {}).filter(([code]) => allowed.has(code)));
}
