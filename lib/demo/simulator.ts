/**
 * Simulateur d'ad server (mode démo) — logique pure. À partir du plan poussé (parts
 * par item) + un seed, produit la délivrance datée qu'un ad server reporterait, contre
 * une RÉSISTANCE cachée fixe par CP. La délivrance réagit au poids (monotone) → le rebid
 * fait converger la conformité v1→v2→v3. Déterministe par le seed.
 */
import { rngFor } from '@/lib/demo/rng';

export interface SimItem {
  zone_id: string;
  item_id: string;
  expected_share: number; // part poussée de l'item (intra-zone, depuis le snapshot)
  cps: string[];
}

export interface SimInput {
  items: SimItem[];
  audienceByCp: Record<string, number>; // ex. ref_codes_postaux.pop_total
  seed: number;
  period: number;      // fait varier le bruit d'une période à l'autre (résistance, elle, fixe)
  totalVolume: number; // impressions totales de la période
  gain?: number;       // sensibilité au poids (défaut 3)
  noise?: number;      // amplitude du bruit (défaut 0.1)
}

export interface SimDeliveryRow {
  postal_code: string;
  impressions: number;
  clicks: number;
  spend: number;
}

const saturate = (x: number): number => x / (1 + x); // monotone croissante, bornée à 1

export function simulateDelivery(input: SimInput): SimDeliveryRow[] {
  const gain = input.gain ?? 3;
  const noise = input.noise ?? 0.1;

  // Poids poussé par CP (chaque CP appartient à un item)
  const weightByCp = new Map<string, number>();
  for (const it of input.items) for (const cp of it.cps) weightByCp.set(cp, it.expected_share);

  // Délivrance brute par CP
  const raw: Array<{ cp: string; v: number }> = [];
  for (const [cp, weight] of weightByCp) {
    const audience = input.audienceByCp[cp] ?? 0;
    const resistance = 0.3 + 0.7 * rngFor(input.seed, `res:${cp}`);      // FIXE par (seed, cp)
    const noiseTerm = 1 + (rngFor(input.seed, `noise:${input.period}:${cp}`) - 0.5) * 2 * noise;
    const v = audience * saturate(weight * gain * resistance) * noiseTerm;
    raw.push({ cp, v: Math.max(0, v) });
  }

  const sum = raw.reduce((s, r) => s + r.v, 0) || 1;
  return raw.map(({ cp, v }) => {
    const impressions = Math.round((v / sum) * input.totalVolume);
    const ctr = 0.005 + 0.02 * rngFor(input.seed, `ctr:${cp}`);
    const cpm = 3 + 4 * rngFor(input.seed, `cpm:${cp}`);
    return {
      postal_code: cp,
      impressions,
      clicks: Math.round(impressions * ctr),
      spend: Math.round((impressions / 1000) * cpm * 100) / 100,
    };
  });
}
