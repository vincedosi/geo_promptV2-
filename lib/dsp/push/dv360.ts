/** Connecteur DV360 réel : script custom bidding + budget IO, best-effort. */
import { buildWeightedZoneBiddingScript } from '@/lib/digital/dv360-bidding-script';
import { resolveAccessToken, uploadCustomBiddingScript, patchInsertionOrderBudget } from '@/lib/dsp/dv360/client';
import type { BiddingPushContext, BiddingPushResult, BiddingPusher } from './types';

export const dv360Pusher: BiddingPusher = {
  channel: 'dv360',
  async push(ctx: BiddingPushContext): Promise<BiddingPushResult> {
    const links = ctx.links?.dv360;
    if (!links?.advertiser_id || (!links.algorithm_id && !links.insertion_order_id)) {
      return {
        channel: 'dv360',
        status: 'skipped',
        detail: 'IDs DV360 non renseignés (advertiser + algorithme ou insertion order) — à saisir dans la section Canaux',
        payload_summary: {},
      };
    }
    if (!ctx.connection) {
      return { channel: 'dv360', status: 'skipped', detail: 'Connexion DV360 absente', payload_summary: {} };
    }
    const token = await resolveAccessToken(ctx.connection);
    const done: string[] = [];
    const payload: Record<string, unknown> = {};
    if (links.algorithm_id && ctx.tiers.length > 0) {
      const script = buildWeightedZoneBiddingScript(ctx.zoneName, ctx.tiers);
      const { scriptName } = await uploadCustomBiddingScript(token, links.advertiser_id, links.algorithm_id, script);
      done.push('script custom bidding');
      payload.script_name = scriptName;
      payload.tiers_count = ctx.tiers.length;
    }
    if (links.insertion_order_id && ctx.budgetChanged && ctx.channelBudget != null) {
      await patchInsertionOrderBudget(token, links.advertiser_id, links.insertion_order_id, Math.round(ctx.channelBudget * 1_000_000));
      done.push(`budget IO ${ctx.channelBudget} €`);
      payload.budget = ctx.channelBudget;
    }
    if (done.length === 0) {
      return { channel: 'dv360', status: 'skipped', detail: 'Rien à pousser (ni script ni delta budget)', payload_summary: {} };
    }
    return { channel: 'dv360', status: 'pushed', detail: `Poussé : ${done.join(' + ')}`, payload_summary: payload };
  },
};
