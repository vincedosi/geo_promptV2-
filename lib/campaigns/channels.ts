/**
 * Canaux d'une campagne (DSP / réseaux sociaux / ad server) — logique pure.
 * Le catalogue vient de dsp_channel_registry ; le « connecté » de dsp_connections.
 */
import { z } from 'zod';

export type ChannelCategory = 'dsp' | 'social' | 'adserver';

export interface ChannelRow {
  code: string;
  label: string;
  category: ChannelCategory;
  connection_provider: string | null;
  active: boolean;
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

export interface Dv360Links {
  advertiser_id?: string;
  advertiser_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  insertion_order_id?: string;
  insertion_order_name?: string;
  algorithm_id?: string;
}
/** Une entrée par provider (clé = connection_provider du registre). DV360 seul
 *  aujourd'hui ; TikTok/Meta/TTD s'ajoutent ici quand leur connexion arrive. */
export interface DspLinks { dv360?: Dv360Links }

/** Forme complète stockée dans geo_strategy.channels. */
export interface StoredChannels extends CampaignChannels {
  budgets?: ChannelBudgets;
  links?: DspLinks;
}

export const ChannelBudgetsSchema = z.record(
  z.string().min(1).max(50),
  z.number().min(0).finite(),
);

export const DspLinksSchema = z.object({
  dv360: z.object({
    advertiser_id: z.string().max(50).optional(),
    advertiser_name: z.string().max(200).optional(),
    campaign_id: z.string().max(50).optional(),
    campaign_name: z.string().max(200).optional(),
    insertion_order_id: z.string().max(50).optional(),
    insertion_order_name: z.string().max(200).optional(),
    algorithm_id: z.string().max(50).optional(),
  }).optional(),
});

/**
 * Garde uniquement les liaisons des providers dont un canal est encore
 * sélectionné (purge au retrait du canal, comme pruneBudgets).
 * `providerByCode` = code canal → connection_provider (registre).
 */
export function pruneLinks(
  links: DspLinks | null | undefined,
  sel: CampaignChannels,
  providerByCode: Record<string, string | null>,
): DspLinks {
  if (!links) return {};
  const selectedProviders = new Set(
    [...sel.dsps, ...sel.socials]
      .map((code) => providerByCode[code])
      .filter((p): p is string => !!p),
  );
  return Object.fromEntries(
    Object.entries(links).filter(([provider]) => selectedProviders.has(provider)),
  ) as DspLinks;
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
