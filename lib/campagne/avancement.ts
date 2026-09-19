/**
 * Calculs partagés du bandeau d'avancement et du bloc « Coût et rythme ».
 *
 * Source : `GET /api/digital/[campaignId]/suivi` (RPC `get_campaign_suivi`,
 * sql/108 puis sql/113) — route KEPT, `pacing` + `objective` + `cpm` déjà
 * produits, rien à recalculer côté base.
 *
 * `objective.expected` est la cible PRORATISÉE au temps écoulé
 * (`get_campaign_expected`, sql/113) : `expected = cible_totale × time_pct / 100`,
 * linéairement dans le temps par construction, quelle que soit la base
 * (kpi_target ou budget/CPM prévu). `volumeCibleTotal` inverse cette formule
 * plutôt que de rejouer la distinction kpi/forecast que la RPC a déjà
 * tranchée — une deuxième lecture de `basis` ici serait une deuxième source
 * de vérité pour la même décision.
 */

export interface Pacing {
  spend: number
  total_budget: number | null
  budget_pct: number | null
  time_pct: number | null
  index: number | null
}

export interface ObjectifCampagne {
  realized: number
  expected: number | null
  pct: number | null
}

/**
 * Cible TOTALE de volume sur toute la campagne (pas la cible proratisée que
 * porte déjà `objective.expected`) : `expected / (time_pct / 100)`.
 * `null` tant que `time_pct` n'est pas positif — on ne peut pas remonter à un
 * total à partir d'une part de temps nulle.
 */
export function volumeCibleTotal(objective: ObjectifCampagne, timePct: number | null): number | null {
  if (objective.expected == null || timePct == null || timePct <= 0) return null
  return objective.expected / (timePct / 100)
}

/**
 * Pourcentage du volume TOTAL prévu déjà livré — sur la MÊME échelle que
 * `budget_pct` et `time_pct` (part du total de campagne, pas part de ce qui
 * était attendu à cette date comme le fait `objective.pct`).
 */
export function pourcentageVolumeLivre(objective: ObjectifCampagne, timePct: number | null): number | null {
  const cible = volumeCibleTotal(objective, timePct)
  if (cible == null || cible <= 0) return null
  return Math.round((objective.realized / cible) * 1000) / 10
}
