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
