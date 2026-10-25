/**
 * Canaux d'une campagne (DSP / réseaux sociaux / ad server) — logique pure.
 * Le catalogue vient de dsp_channel_registry ; le « connecté » de dsp_connections.
 */
import { z } from 'zod';
import { DspLinksSchema, type DspLinks, type LinkLevel } from './platform-links';

// Liaison plateforme générique — définie dans platform-links.ts, ré-exportée
// ici pour les importeurs historiques (routes, schémas, panels).
export {
  DspLinksSchema, PlatformLinksSchema, pruneLinks, linksComplete, linksSummary,
} from './platform-links';
export type { DspLinks, Dv360Links, LinkLevel, PlatformLinks } from './platform-links';

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

export const CampaignChannelsSchema = z.object({
  dsps: z.array(z.string().min(1).max(50)).max(10),
  socials: z.array(z.string().min(1).max(50)).max(10),
  ad_server: z.string().min(1).max(50).nullable(),
});

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

// ── Budgets par canal & liens DSP (geo_strategy.channels.budgets / .links) ─────
/** Une ligne de budget (€) par canal DSP/social sélectionné. Global = somme. */
export type ChannelBudgets = Record<string, number>;

/** Forme complète stockée dans geo_strategy.channels. */
export interface StoredChannels extends CampaignChannels {
  budgets?: ChannelBudgets;
  /**
   * CPM prévu (€) par canal DSP/social (étape ⑥ de la carte, lot 6, A-10) : même forme, même élagage que `budgets`.
   * Les impressions prévues n'y sont pas : elles se dérivent (budget ÷ CPM × 1 000), une seule formule.
   */
  cpm_prevus?: ChannelBudgets;
  links?: DspLinks;
}

const ChannelBudgetsSchema = z.record(
  z.string().min(1).max(50),
  z.number().min(0).finite(),
);

/** Corps du PUT `/api/campaigns/[campaignId]/channels` : la sélection, et facultativement budgets, CPM et liens. */
export const ChannelsPutSchema = CampaignChannelsSchema.extend({
  budgets: ChannelBudgetsSchema.optional(),
  cpm_prevus: ChannelBudgetsSchema.optional(),
  links: DspLinksSchema.optional(),
});

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
