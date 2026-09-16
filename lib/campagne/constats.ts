/**
 * « Ce qu'il faut corriger » — les constats du bloc de suivi.
 *
 * Les constats sont CALCULÉS, jamais rédigés en dur : trois familles
 * (concentration de la sous-pression, concentration de la sur-pression,
 * canal le plus cher), chacune produisant AU PLUS UN constat. Un constat qui
 * ne s'applique pas ne s'affiche pas — il n'y a donc pas toujours trois
 * lignes, et une campagne saine en produit zéro.
 *
 * Source des `unites` : `alignement_par_maille` (sql/165), à la maille
 * département. `ecart_pct` y est déjà `((réel / plan) - 1) × 100` — c'est le
 * SEUL champ dont cette fonction dispose pour juger un écart : `plan` n'est
 * pas transmis ici, il est ré-estimé (`planEstime`) à partir de `impressions`
 * et `ecart_pct` quand un montant est nécessaire (volume manquant, euros
 * déplaçables). C'est une inversion de la formule ci-dessus, pas une
 * deuxième source de vérité.
 */
import { formaterNombre } from '@/lib/format/nombre'

/** Une unité géographique (ici : département) telle que rendue par `alignement_par_maille`. */
export interface UniteConstat {
  code: string
  nom: string
  ecart_pct: number | null
  impressions: number
  cpm: number | null
  /**
   * Vrai quand l'unité a reçu des impressions SANS AUCUN plan (`part_plan = 0`
   * dans `alignement_par_maille`, sql/165) — 400 CP sur 2 041 sur la campagne
   * démo (19,6 %, ruling T6-3). `ecart_pct` y est alors `null` : aucun
   * pourcentage n'est définissable sur un plan nul. Optionnel pour que les
   * fixtures qui l'ignorent (le test du brief) restent valides — `undefined`
   * se comporte comme `false`.
   */
  hors_plan?: boolean
  /**
   * Volume déjà calculé par `alignement_par_maille` (`abs(réel − plan)`,
   * défini PARTOUT y compris à plan nul). Utilisé tel quel pour une unité
   * `hors_plan` plutôt que ré-estimé : à plan nul, `planEstime` renverrait de
   * toute façon `impressions`, donc `volume_deplace` EST déjà la bonne
   * réponse — pas une deuxième source.
   */
  volume_deplace?: number
}

/** Un canal/acteur avec son CPM moyen, tel que rendu par `get_campaign_actors`. */
export interface CanalConstat {
  code: string
  cpm: number | null
}

export interface DonneesConstats {
  unites: UniteConstat[]
  cpm_moyen: number | null
  canaux: CanalConstat[]
}

export interface Constat {
  id: string
  titre: string
  action: string
  /** Code de l'unité ou du canal que ce constat désigne — sert de cible à l'action. */
  cible: string | null
}

/**
 * Seuil d'écart (en %) à partir duquel une unité est jugée assez déréglée
 * pour mériter une ligne dans « Ce qu'il faut corriger ». DISTINCT de
 * `tolerance_pct` (réglage par campagne qui définit la conformité du SCORE
 * lui-même, cf. `ScoreAlignement`/`TroisComposantes`) : ce seuil-ci est FIXE
 * et volontairement plus large qu'une tolérance habituelle (souvent ~10 %),
 * parce que ce bloc ne doit remonter que des écarts massifs et actionnables
 * — pas le bruit qu'une tolérance à 10 % laisse déjà passer comme « hors
 * plan » dans le score.
 */
export const SEUIL_ECART_SIGNALE_PCT = 20

/**
 * Seuil de CPM jugé « nettement plus cher que la moyenne ».
 *
 * Exporté à dessein : la Tâche 14 (« Qui a diffusé ») signale le même
 * dépassement et doit importer CETTE constante plutôt que d'en retyper une
 * seconde — ce projet comptait quinze copies de `fmtNum` avant leur
 * unification (`lib/format/nombre.ts`), on ne recommence pas avec un seuil.
 */
export const SEUIL_CPM_CHER = 1.25

/** Nombre maximal de constats affichés, les plus lourds d'abord. */
const MAX_CONSTATS = 3

/**
 * Ré-estime le volume planifié d'une unité à partir de son écart et de ses
 * impressions réelles, en inversant `ecart_pct = ((réel / plan) − 1) × 100`
 * (formule de `alignement_par_maille`, sql/165) : `plan = réel / (1 + écart/100)`.
 * `null` sur un écart dégénéré (≤ -100 %, dénominateur nul ou négatif) plutôt
 * qu'une division qui rendrait une valeur absurde en silence.
 */
function planEstime(impressions: number, ecartPct: number): number | null {
  const facteur = 1 + ecartPct / 100
  if (facteur <= 0) return null
  return impressions / facteur
}

/** « Nom (code) et Nom (code) » — jamais plus de deux unités nommées. */
function listerUnites(unites: { code: string; nom: string }[]): string {
  return unites.map((u) => `${u.nom} (${u.code})`).join(' et ')
}

/** Concentration de la sous-pression : les unités les plus en retard, volume manquant estimé décroissant. */
function constatSousPression(unites: UniteConstat[]): Constat | null {
  const candidats: { u: UniteConstat; manque: number }[] = []
  for (const u of unites) {
    if (u.ecart_pct == null || u.ecart_pct >= -SEUIL_ECART_SIGNALE_PCT) continue
    const plan = planEstime(u.impressions, u.ecart_pct)
    if (plan == null) continue
    candidats.push({ u, manque: Math.max(0, plan - u.impressions) })
  }
  if (candidats.length === 0) return null
  candidats.sort((a, b) => b.manque - a.manque)

  const top = candidats.slice(0, 2)
  const total = Math.round(top.reduce((s, c) => s + c.manque, 0))
  const verbe = top.length > 1 ? 'concentrent' : 'concentre'

  return {
    id: 'sous_pression',
    titre: `${listerUnites(top.map((c) => c.u))} ${verbe} la sous-pression : ${formaterNombre(total)} impressions manquantes`,
    action: 'Voir sur la carte',
    cible: top[0].u.code,
  }
}

/**
 * Concentration de la sur-pression : symétrique, chiffrée en euros
 * déplaçables via le CPM de l'unité.
 *
 * Ruling T11-2 : une unité `hors_plan` (plan nul, `ecart_pct` donc `null`)
 * est la sur-pression la plus pure qui soit — LA TOTALITÉ de son volume est
 * en trop, puisqu'aucun plan ne l'attendait. Le filtre sur `ecart_pct`
 * ci-dessous l'aurait exclue en silence ; elle est comptée à part, AVANT ce
 * filtre, avec tout son volume (`volume_deplace` si fourni, sinon
 * `impressions` — les deux coïncident à plan nul).
 */
function constatSurPression(unites: UniteConstat[]): Constat | null {
  const candidats: { u: UniteConstat; trop: number; eur: number }[] = []
  for (const u of unites) {
    if (u.hors_plan) {
      const trop = u.volume_deplace ?? u.impressions
      if (trop > 0) candidats.push({ u, trop, eur: u.cpm != null ? (trop / 1000) * u.cpm : 0 })
      continue
    }
    if (u.ecart_pct == null || u.ecart_pct <= SEUIL_ECART_SIGNALE_PCT) continue
    const plan = planEstime(u.impressions, u.ecart_pct)
    if (plan == null) continue
    const trop = Math.max(0, u.impressions - plan)
    candidats.push({ u, trop, eur: u.cpm != null ? (trop / 1000) * u.cpm : 0 })
  }
  if (candidats.length === 0) return null

  // Le TRI et la MESURE AFFICHÉE sont la même grandeur : les euros. Classer
  // par volume (`trop`) puis titrer en euros laissait une unité au `cpm` nul
  // gagner le classement avec `eur: 0` — et le constat annonçait « X et Y
  // concentrent la sur-pression : 0 € déplaçables », une phrase qui se
  // contredit elle-même. Départage par volume à euros égaux, pour que deux
  // unités sans dépense renseignée restent classées par ce qu'on sait d'elles.
  candidats.sort((a, b) => (b.eur - a.eur) || (b.trop - a.trop))

  const top = candidats.slice(0, 2)
  const totalEur = Math.round(top.reduce((s, c) => s + c.eur, 0))
  const totalTrop = Math.round(top.reduce((s, c) => s + c.trop, 0))
  const verbe = top.length > 1 ? 'concentrent' : 'concentre'

  // Aucune dépense renseignée sur ces unités (`cpm` nul) : on chiffre ce que
  // la base sait — le volume — plutôt qu'un « 0 € » qui nierait le constat
  // qu'il est censé porter. Toujours chiffré, jamais un adjectif.
  const mesure = totalEur > 0
    ? `${formaterNombre(totalEur)} € déplaçables`
    : `${formaterNombre(totalTrop)} impressions à redéployer`

  return {
    id: 'sur_pression',
    titre: `${listerUnites(top.map((c) => c.u))} ${verbe} la sur-pression : ${mesure}`,
    action: 'Rééquilibrer les poids',
    cible: top[0].u.code,
  }
}

/** Le canal le plus cher, si son CPM dépasse `cpm_moyen × SEUIL_CPM_CHER`. */
function constatCanalCher(canaux: CanalConstat[], cpmMoyen: number | null): Constat | null {
  if (cpmMoyen == null || cpmMoyen <= 0) return null

  const candidats = canaux
    .filter((c): c is CanalConstat & { cpm: number } => c.cpm != null && c.cpm > cpmMoyen * SEUIL_CPM_CHER)
    .sort((a, b) => b.cpm - a.cpm)
  if (candidats.length === 0) return null

  const pire = candidats[0]
  const ecartPct = Math.round(((pire.cpm - cpmMoyen) / cpmMoyen) * 1000) / 10

  return {
    id: 'canal_cher',
    titre:
      `Le canal ${pire.code} paie son audience ${formaterNombre(ecartPct)} % plus cher que la moyenne ` +
      `(${formaterNombre(pire.cpm)} € contre ${formaterNombre(cpmMoyen)} € en moyenne)`,
    action: 'Voir le détail',
    cible: pire.code,
  }
}

/**
 * Calcule les constats de correction. Trois familles évaluées dans cet
 * ordre (sous-pression, sur-pression, canal cher) ; chacune produit au plus
 * un constat, donc le plafond de trois est toujours respecté sans tri
 * inter-familles — les trois métriques (impressions manquantes, euros
 * déplaçables, écart de CPM) ne sont pas sur la même échelle et ne se
 * comparent pas honnêtement entre elles avec les seules données reçues ici.
 */
export function calculerConstats(data: DonneesConstats): Constat[] {
  const constats = [
    constatSousPression(data.unites),
    constatSurPression(data.unites),
    constatCanalCher(data.canaux, data.cpm_moyen),
  ].filter((c): c is Constat => c !== null)

  return constats.slice(0, MAX_CONSTATS)
}
