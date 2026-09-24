/**
 * L'alignement d'une campagne simulée, ZONE PAR ZONE, sur la population EXPOSÉE.
 *
 * ── LE PLAN D'UNE ZONE ────────────────────────────────────────────────────
 *
 * La part du plan d'un bassin est sa part de la POPULATION EXPOSÉE du jeu —
 * jamais la population totale de ses codes postaux. C'est le principe du
 * module : on veut toucher des habitants exposés, et un code postal dilué qui
 * gonfle la population achetée ne doit pas gonfler la cible de sa zone.
 *
 * ── LA DIFFUSION D'UNE ZONE ───────────────────────────────────────────────
 *
 * Seules les impressions UTILES comptent : une impression sur un code postal
 * touche toute sa population, dont une part seulement vit en zone
 * (`part_en_zone`). Compter les impressions brutes récompenserait l'achat des
 * codes postaux les plus dilués.
 *
 * ── LE SCORE ──────────────────────────────────────────────────────────────
 *
 * ⚠ La règle est celle du Suivi, `calculerAlignement`
 * (`lib/campagne/alignement.ts`) : même tolérance, même pénalité, même sens.
 * Une seconde formule donnerait deux scores d'alignement dans le même produit,
 * qu'aucun utilisateur ne saurait départager. Seule l'UNITÉ change : le bassin
 * au lieu du code postal.
 */
import { calculerAlignement } from '@/lib/campagne/alignement';
import type { CpSimulation } from '@/lib/simulation/types';

/** Tolérance par défaut, la même que `dsp_campaigns.tolerance_pct`. */
const TOLERANCE_DEFAUT = 10;

/** Poids de la sur-pression par défaut, le même que `overpressure_weight`. */
const POIDS_SURPRESSION_DEFAUT = 1;

/**
 * La part du plan de chaque bassin : sa part de population exposée.
 *
 * ⚠ Les membres non canoniques d'un groupe sont écartés : leur ligne porte la
 * population du groupe ENTIER, que la ligne canonique porte déjà. Les compter
 * multiplierait Nantes par quatre (sql/228).
 */
export function cibleParZone(cps: CpSimulation[]): Map<string, number> {
  const brut = new Map<string, number>();
  let total = 0;
  for (const c of cps) {
    if (c.membre || !c.cluster_id || c.pop_en_zone <= 0) continue;
    brut.set(c.cluster_id, (brut.get(c.cluster_id) ?? 0) + c.pop_en_zone);
    total += c.pop_en_zone;
  }
  const out = new Map<string, number>();
  if (total <= 0) return out;
  for (const [z, v] of brut) out.set(z, v / total);
  return out;
}

/** Les impressions utiles d'un volume diffusé sur un code postal. */
export function impressionsUtiles(impressions: number, partEnZone: number): number {
  return impressions * Math.min(100, Math.max(0, partEnZone)) / 100;
}

/** Une zone, telle que l'écran la lit. */
interface AlignementZone {
  cluster_id: string;
  /** Part de la population exposée du jeu, de 0 à 1. */
  part_plan: number;
  /** Part des impressions utiles de la période, de 0 à 1. */
  part_diffusee: number;
  /** Part diffusée ÷ part du plan × 100 ; `null` si la zone n'a pas de plan. */
  indice: number | null;
  utiles: number;
}

export type ResultatAlignementZones =
  | { calculable: true; score: number; zones: AlignementZone[] }
  | { calculable: false; raison: 'aucune_diffusion' | 'plan_vide'; zones: AlignementZone[] };

/** Ce que l'écran affiche quand le score n'est pas calculable. */
export const RAISON_NON_CALCULABLE: Record<'aucune_diffusion' | 'plan_vide', string> = {
  aucune_diffusion: 'Aucune impression utile sur la période : il n’y a pas d’écart à mesurer.',
  plan_vide: 'Le jeu ne porte aucune population exposée par zone : il n’y a pas de plan à tenir.',
};

/**
 * L'alignement d'une période, par zone.
 *
 * @param utiles - Les impressions utiles de la période, par bassin.
 * @param cible - La part du plan de chaque bassin (`cibleParZone`).
 * @returns Le score et le détail par zone, ou la raison pour laquelle il n'y a
 *   pas de score. JAMAIS un score parfait par défaut : un 100 sans écart
 *   mesurable serait un mensonge (même règle que sql/209 côté Suivi).
 */
export function alignementParZone(
  utiles: Map<string, number>,
  cible: Map<string, number>,
  tolerance = TOLERANCE_DEFAUT,
  poidsSurpression = POIDS_SURPRESSION_DEFAUT,
): ResultatAlignementZones {
  const total = [...utiles.values()].reduce((t, v) => t + v, 0);
  const codes = new Set([...cible.keys(), ...utiles.keys()]);
  const zones: AlignementZone[] = [...codes].map((z) => {
    const plan = cible.get(z) ?? 0;
    const u = utiles.get(z) ?? 0;
    const diff = total > 0 ? u / total : 0;
    return {
      cluster_id: z,
      part_plan: plan,
      part_diffusee: diff,
      indice: plan > 0 && total > 0 ? (diff / plan) * 100 : null,
      utiles: u,
    };
  });

  if (cible.size === 0) return { calculable: false, raison: 'plan_vide', zones };
  if (total <= 0) return { calculable: false, raison: 'aucune_diffusion', zones };

  const r = calculerAlignement(
    zones.map((z) => ({ code: z.cluster_id, reel: z.utiles, plan: z.part_plan * total })),
    tolerance,
    poidsSurpression,
  );
  if (!r) return { calculable: false, raison: 'plan_vide', zones };
  return { calculable: true, score: r.score, zones };
}
