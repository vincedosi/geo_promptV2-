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
 * Jumeau SQL : `calculer_alignement_geo` (sql/165, corrigée sql/172). Les deux
 * DOIVENT arrondir identiquement — voir tests/unit/campagne/alignement.test.ts.
 *
 * ── « Pas calculable » n'est ni 0 ni 100 (2026-09-15) ─────────────────────
 * Ce jumeau rendait `score: 100, conformes_pct: 100` sur un jeu vide ou sans
 * volume réel ; la RPC rendait `score: 0, conformes_pct: null` pour la MÊME
 * entrée (mesuré sur une campagne sans rollup). ARCHITECTURE.md affirmait
 * « accord exact » entre les deux : vrai du chemin nominal — croisé en base
 * sur la campagne démo, 2 041 CP, score 93 des deux côtés — faux du cas
 * dégénéré, celui qu'un jumeau sert justement à cadrer.
 *
 * Aucun des deux n'avait raison. Un alignement de 100 sur une campagne qui n'a
 * rien diffusé la déclare parfaite ; un alignement de 0 la déclare
 * catastrophique. Les deux inventent un verdict là où il n'y a rien à mesurer.
 * Les deux implémentations disent désormais la même chose : `null` ici,
 * `{error: 'aucune_donnee', calculable: false}` côté SQL.
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

/**
 * Rend `null` quand le score n'est PAS CALCULABLE : aucune unité, ou aucune
 * impression réelle à répartir entre elles. Le dénominateur de toutes les
 * pénalités est le volume réel total ; sans lui, il n'y a pas de score « par
 * défaut » à produire — seulement un verdict à ne pas rendre.
 */
export function calculerAlignement(
  unites: UniteAlignement[],
  tolerancePct: number,
  poidsSurpression: number,
): ResultatAlignement | null {
  if (unites.length === 0) return null

  const t = tolerancePct / 100
  const totalReel = unites.reduce((s, u) => s + u.reel, 0)
  if (totalReel <= 0) return null

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
