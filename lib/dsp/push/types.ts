/**
 * Connecteurs de push bidding — un connecteur par canal, même signature.
 * simulated = payload réel construit, aucune API appelée (démo / non connecté).
 * skipped   = volontairement non poussé (connecteur absent, links manquants).
 */
import type { WeightedBiddingTier } from '@/lib/digital/dv360-bidding-script';
import type { DspLinks } from '@/lib/campaigns/channels';
import type { Dv360ConnectionRow } from '@/lib/dsp/dv360/client';

export type PushStatus = 'pushed' | 'simulated' | 'failed' | 'skipped';

export interface BiddingPushContext {
  channel: string; // code dsp_channel_registry (dv360, ttd, meta, tiktok…)
  campaign: { id: string; name: string; is_demo: boolean };
  /** Budget (€) de la ligne de CE canal — jamais le global. */
  channelBudget: number | null;
  budgetChanged: boolean;
  zoneName: string;
  /** Items + CP + score (poids/100) du snapshot v+1 ; vide si pas de snapshot. */
  tiers: WeightedBiddingTier[];
  connection: Dv360ConnectionRow | null;
  links: DspLinks | null;
  isDemo: boolean;
}

export interface BiddingPushResult {
  channel: string;
  status: PushStatus;
  detail: string;
  payload_summary: Record<string, unknown>;
}

export interface BiddingPusher {
  channel: string;
  push(ctx: BiddingPushContext): Promise<BiddingPushResult>;
}
