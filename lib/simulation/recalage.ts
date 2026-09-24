/**
 * Le recalage d'une campagne : de l'extraction v1 à l'extraction v2.
 *
 * ── CE QU'IL FAIT ─────────────────────────────────────────────────────────
 *
 * Deux corrections, et seulement deux, celles qu'un media planner ferait :
 *
 * 1. **Par zone** : chaque bassin voit ses multiplicateurs corrigés du rapport
 *    entre sa part de plan et sa part diffusée OBSERVÉE. Une zone qui a reçu
 *    deux fois trop voit ses enchères divisées, une zone qui n'a rien reçu les
 *    voit relevées.
 * 2. **Les codes postaux très dilués baissent** : sous le seuil de dilution,
 *    une impression y touche surtout des habitants hors zone.
 *
 * ── CE QU'IL NE FAIT PAS ──────────────────────────────────────────────────
 *
 * ⚠ Il ne vise pas un score. La correction est bornée (entre ÷3 et ×3) et
 * AMORTIE (`amortissement`) : corriger d'un coup l'intégralité de l'écart
 * observé sur deux semaines, c'est sur-réagir au bruit. Et l'inventaire
 * continue de dériver après le recalage : la v2 fait mieux que la v1 sans
 * jamais être parfaite — c'est ce qui la rend crédible.
 */
import type { CpSimulation, ParamsSimulation } from '@/lib/simulation/types';

/** Bornes de la correction d'une zone : jamais plus d'un facteur 3. */
const CORRECTION_MIN = 1 / 3;
const CORRECTION_MAX = 3;

/** Bornes d'un multiplicateur, les mêmes que `genererPlanCp` (`lib/zones/plan.ts`). */
const MULT_MIN_NON_NUL = 0.001;
const MULT_MAX = 999.999;

export interface Recalage {
  /** Le multiplicateur v2 de chaque code postal. */
  multiplicateurs: Map<string, number>;
  /** Le facteur appliqué à chaque bassin, avant renormalisation. */
  corrections: Map<string, number>;
  /** Les codes postaux baissés pour dilution. */
  dilues: string[];
}

/**
 * Calcule l'extraction v2.
 *
 * @param cps - Les codes postaux de l'extraction v1.
 * @param utilesObservees - Les impressions utiles des semaines v1, par bassin.
 * @param cible - La part du plan de chaque bassin (`cibleParZone`).
 * @param P - Les paramètres (amortissement, seuil et baisse de dilution).
 */
export function recaler(
  cps: CpSimulation[],
  utilesObservees: Map<string, number>,
  cible: Map<string, number>,
  P: ParamsSimulation,
): Recalage {
  const total = [...utilesObservees.values()].reduce((t, v) => t + v, 0);

  const corrections = new Map<string, number>();
  for (const [z, plan] of cible) {
    const obs = total > 0 ? (utilesObservees.get(z) ?? 0) / total : 0;
    // Une zone qui n'a rien reçu prend la correction maximale : son écart est
    // infini, et le borner vaut mieux que de l'ignorer.
    const brut = obs > 0 ? plan / obs : CORRECTION_MAX;
    const borne = Math.min(CORRECTION_MAX, Math.max(CORRECTION_MIN, brut));
    corrections.set(z, Math.pow(borne, P.amortissement));
  }

  const dilues: string[] = [];
  const bruts = new Map<string, number>();
  for (const c of cps) {
    if (c.multiplicateur <= 0) continue;
    let m = c.multiplicateur;
    if (c.cluster_id) m *= corrections.get(c.cluster_id) ?? 1;
    if (c.part_en_zone < P.seuilDilution) {
      m *= P.baisseDilues;
      dilues.push(c.code_postal);
    }
    bruts.set(c.code_postal, m);
  }

  // Recentré sur 1, comme `genererPlanCp` : le DSP lit des multiplicateurs
  // autour de la valeur neutre, et un plan qui dériverait vers 0,2 ou 5 en
  // moyenne changerait l'enchère de base sans le dire.
  const moyenne = [...bruts.values()].reduce((t, v) => t + v, 0) / Math.max(1, bruts.size);
  const multiplicateurs = new Map<string, number>();
  for (const [cp, m] of bruts) {
    const centre = moyenne > 0 ? m / moyenne : 1;
    const arrondi = Math.round(centre * 1000) / 1000;
    multiplicateurs.set(cp, Math.min(MULT_MAX, Math.max(MULT_MIN_NON_NUL, arrondi)));
  }
  return { multiplicateurs, corrections, dilues };
}
