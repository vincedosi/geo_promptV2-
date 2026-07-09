/**
 * Connecteur simulé : construit EXACTEMENT ce qui serait envoyé (script custom
 * bidding pondéré, delta budget) mais n'appelle aucune API. C'est ce payload
 * qui est journalisé — le mode démo montre le vrai contenu.
 */
import { buildWeightedZoneBiddingScript } from '@/lib/digital/dv360-bidding-script';
import type { BiddingPushContext, BiddingPushResult, BiddingPusher } from './types';

export function buildPayloadSummary(ctx: BiddingPushContext): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (ctx.tiers.length > 0) {
    summary.script = buildWeightedZoneBiddingScript(ctx.zoneName, ctx.tiers);
    summary.tiers_count = ctx.tiers.length;
  }
  if (ctx.budgetChanged && ctx.channelBudget != null) summary.budget = ctx.channelBudget;
  return summary;
}

export function simulatedPusher(channel: string): BiddingPusher {
  return {
    channel,
    async push(ctx: BiddingPushContext): Promise<BiddingPushResult> {
      const payload = buildPayloadSummary(ctx);
      const parts = [
        payload.script ? 'script custom bidding' : null,
        payload.budget != null ? `budget ${ctx.channelBudget} €` : null,
      ].filter(Boolean);
      return {
        channel,
        status: 'simulated',
        detail: parts.length
          ? `Simulé (${ctx.isDemo ? 'mode démo' : 'canal non connecté'}) : ${parts.join(' + ')}`
          : `Simulé (${ctx.isDemo ? 'mode démo' : 'canal non connecté'}) : rien à pousser`,
        payload_summary: payload,
      };
    },
  };
}

export function skippedPusher(channel: string, detail: string): BiddingPusher {
  return {
    channel,
    async push(): Promise<BiddingPushResult> {
      return { channel, status: 'skipped', detail, payload_summary: {} };
    },
  };
}
