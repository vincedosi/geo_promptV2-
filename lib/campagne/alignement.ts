/**
 * Score d'alignement géographique — l'indicateur signature de MAGELIAN.
 *
 * Mesure si la pression réelle respecte le plan, unité par unité, en pénalisant
 * LES DEUX SENS : sous-pression (volume manquant) et sur-pression (volume en
 * trop, qui aurait dû aller ailleurs).
 *
 * Ce n'est PAS un indicateur de ciblage. On vise rarement une partie seulement
 * de la France ; l'enjeu est la répartition, pas le périmètre.
 *
 * Jumeau SQL : `calculer_alignement_geo` (sql/165). Les deux DOIVENT arrondir
 * identiquement — voir tests/unit/campagne/alignement.test.ts.
 */

export interface UniteAlignement {
  code: string
  /** Impressions réellement livrées sur l'unité. */
  reel: number
  /** Impressions que le plan prévoyait sur l'unité (planned_share × total). */
  plan: number
}

export interface ResultatAlignement {
  score: number
  conformes_pct: number
  sous_pression_pct: number
  sur_pression_pct: number
  sous_pression_imps: number
  sur_pression_imps: number
  n_unites: number
}

export function calculerAlignement(
  unites: UniteAlignement[],
  tolerancePct: number,
  poidsSurpression: number,
): ResultatAlignement {
  const vide: ResultatAlignement = {
    score: 100, conformes_pct: 100, sous_pression_pct: 0, sur_pression_pct: 0,
    sous_pression_imps: 0, sur_pression_imps: 0, n_unites: 0,
  }
  if (unites.length === 0) return vide

  const t = tolerancePct / 100
  const totalReel = unites.reduce((s, u) => s + u.reel, 0)
  if (totalReel <= 0) return { ...vide, n_unites: unites.length }

  let manque = 0
  let trop = 0
  let conformes = 0

  for (const u of unites) {
    // Une unité sans plan ne peut pas être « en retard sur son plan ». Son
    // volume compte dans le total, mais elle ne produit pas de sous-pression.
    // La sur-pression, elle, reste mesurable : du volume y est bien parti.
    const bas = u.plan * (1 - t)
    const haut = u.plan * (1 + t)

    if (u.plan > 0 && u.reel >= bas && u.reel <= haut) {
      conformes++
      continue
    }
    if (u.plan > 0 && u.reel < bas) manque += bas - u.reel
    if (u.reel > haut) trop += u.reel - haut
  }

  const sousPct = (manque / totalReel) * 100
  const surPct = (trop / totalReel) * 100
  const penalite = sousPct + poidsSurpression * surPct

  return {
    score: Math.max(0, Math.round(100 - penalite)),
    conformes_pct: Math.round((conformes / unites.length) * 1000) / 10,
    sous_pression_pct: Math.round(sousPct * 100) / 100,
    sur_pression_pct: Math.round(surPct * 100) / 100,
    sous_pression_imps: Math.round(manque),
    sur_pression_imps: Math.round(trop),
    n_unites: unites.length,
  }
}
