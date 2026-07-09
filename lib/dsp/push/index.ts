/**
 * Sélection du connecteur par canal + exécution avec catch → failed.
 * Règles (spec §5) :
 *   démo OU pas de connexion  → simulé (payload réel, zéro appel API)
 *   connexion + connecteur    → réel (pushed/failed)
 *   connexion sans connecteur → skipped
 */
import { dv360Pusher } from './dv360';
import { simulatedPusher, skippedPusher } from './simulated';
import type { BiddingPushContext, BiddingPushResult, BiddingPusher } from './types';

const REAL_PUSHERS: Record<string, BiddingPusher> = { dv360: dv360Pusher };

export function selectPusher(channel: string, isDemo: boolean, hasConnection: boolean): BiddingPusher {
  if (isDemo || !hasConnection) return simulatedPusher(channel);
  return REAL_PUSHERS[channel] ?? skippedPusher(channel, `Connecteur ${channel} non implémenté — push manuel via export`);
}

export async function runPush(ctx: BiddingPushContext): Promise<BiddingPushResult> {
  const pusher = selectPusher(ctx.channel, ctx.isDemo, ctx.connection !== null);
  try {
    return await pusher.push(ctx);
  } catch (e) {
    return {
      channel: ctx.channel,
      status: 'failed',
      detail: e instanceof Error ? e.message.slice(0, 300) : 'Erreur inconnue',
      payload_summary: {},
    };
  }
}

export type { BiddingPushContext, BiddingPushResult } from './types';
