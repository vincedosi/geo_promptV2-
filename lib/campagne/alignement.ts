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
 * Rend `null` quand le score n'est PAS CALCULABLE. Trois cas, et le troisième
 * a été ajouté le 2026-09-20 :
 *
 * 1. aucune unité ;
 * 2. aucune impression réelle à répartir — le dénominateur de toutes les
 *    pénalités est le volume réel total ;
 * 3. **aucune unité ne porte de plan.**
 *
 * ── POURQUOI LE TROISIÈME N'EST NI 0 NI 100 ──────────────────────────────
 *
 * Côté SQL, `calculer_alignement_geo` rendait **100** dans ce cas : zéro écart
 * à un plan qui n'existe pas (mesuré le 2026-09-20 sur la campagne de
 * démonstration, 2 000 CP et 1,2 Md d'impressions). Ce jumeau, lui, rendait
 * **0** — le volume non planifié comptant en totalité en sur-pression.
 *
 * Les deux avaient tort, et ils DIVERGEAIENT : `ARCHITECTURE.md` affirmait
 * leur accord « sur le chemin nominal et sur le cas dégénéré », mais ce
 * cas-ci — des unités, des impressions, aucun plan — n'avait jamais été
 * croisé. 0 se lit « campagne catastrophique », 100 se lit « campagne
 * parfaite » : les deux sont des verdicts, là où il n'y a rien à juger.
 *
 * ⚠ La couverture PARTIELLE, elle, reste calculable — et le volume parti sur
 * une unité sans plan compte EN TOTALITÉ en sur-pression. C'est ce qui
 * garantit qu'une couverture partielle ne peut pas produire un score parfait.
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

  // Aucune unité ne porte de plan : il n'y a pas de score à rendre.
  // ⚠ `> 0` et non `!= null` : un plan à zéro n'est pas un plan. C'est la MÊME
  // condition que `n_cp_plan` côté SQL (sql/209).
  if (!unites.some((u) => u.plan > 0)) return null

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
