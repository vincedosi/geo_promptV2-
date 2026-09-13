/**
 * @file lib/analyses/correlation.ts — corrélation impressions × indicateur
 * (Tâche 13, 2026-09-13).
 *
 * Répond à « ma campagne a-t-elle arrosé les codes postaux qui comptent ? » :
 * apparie les impressions livrées par CP (`campaign_cp_rollup`, DÉJÀ agrégé —
 * ne jamais scanner `dsp_campaign_data`) avec un indicateur INSEE par CP
 * (`indicator_cp_values`), et mesure la relation linéaire entre les deux.
 *
 * **L'appariement se fait EN SQL, pas ici** (`correlation_campagne_indicateur`,
 * sql/147) — écart assumé avec le plan, qui prévoyait une fonction `apparier`
 * en TypeScript. Mesure du 2026-09-13 : une campagne réelle pèse 10 205 lignes
 * de `campaign_cp_rollup` pour 2 041 codes postaux, parce que la clé primaire
 * est (campaign_id, postal_code, ACTEUR) et qu'une campagne a jusqu'à cinq
 * acteurs. Deux conséquences : il faut SOMMER par code postal avant toute
 * corrélation (sans quoi un CP pèse cinq fois), et 10 205 lignes dépassent le
 * plafond de troncature de PostgREST (5 000 par défaut, ARCHITECTURE.md) — les
 * faire descendre dans Node pour les agréger aurait été à la fois plus lourd
 * et silencieusement faux.
 *
 * Logique PURE, testée sans base (`tests/unit/analyses/correlation.test.ts`).
 * `pearson` rend toujours un nombre exploitable : **jamais `NaN`**.
 * Un `NaN` ne s'arrête pas ici, il traverse le JSON, atteint le nuage de points
 * Recharts et casse l'axe — le graphe entier disparaît sans message.
 */

/** Une paire appariée, telle que la RPC la rend — prête pour le nuage de points. */
export interface PaireAppariee {
  code: string;
  /** Impressions livrées sur ce code postal, tous acteurs confondus. */
  x: number;
  /** Valeur de l'indicateur INSEE sur ce même code postal. */
  y: number;
}

/**
 * Coefficient de corrélation linéaire de Pearson, dans [-1, 1].
 *
 * Rend `0` — et jamais `NaN` — dans les quatre cas où la formule n'est pas
 * définie, parce qu'aucun d'eux ne signifie « relation inverse » :
 *   - séries de longueurs différentes (on ne tronque pas en silence) ;
 *   - moins de deux paires exploitables ;
 *   - un écart-type nul (série constante) ;
 *   - aucune paire finie.
 *
 * Les paires dont une valeur n'est pas finie (`NaN`, `Infinity`, `null` passé
 * en `number`) sont ÉCARTÉES ensemble : corréler x[i] avec y[j] d'un autre
 * rang n'aurait aucun sens.
 */
export function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length) return 0;

  const paires: Array<[number, number]> = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) paires.push([xs[i], ys[i]]);
  }
  const n = paires.length;
  if (n < 2) return 0;

  let sx = 0, sy = 0;
  for (const [x, y] of paires) { sx += x; sy += y; }
  const mx = sx / n;
  const my = sy / n;

  let covariance = 0, varianceX = 0, varianceY = 0;
  for (const [x, y] of paires) {
    const dx = x - mx;
    const dy = y - my;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  const denominateur = Math.sqrt(varianceX * varianceY);
  if (denominateur === 0) return 0;

  // Les arrondis flottants peuvent sortir de [-1, 1] au millionième près sur
  // une relation parfaite ; un |r| > 1 affiché serait une aberration visible.
  return Math.max(-1, Math.min(1, covariance / denominateur));
}
