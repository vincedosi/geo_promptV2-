/**
 * @file lib/campagne/graphique-ecart.ts
 *
 * Logique pure de `GraphiqueEcart` (Tâche 12) : le graphique change de FORME
 * avec la maille, pas seulement d'échelle. En Région/Département, une courbe
 * plan/réel garde un sens (peu d'unités). En CP, ~2 000 points alignés ne
 * racontent rien — remplacés par un histogramme de dispersion des écarts,
 * dans les 7 bandes fixes de `BORNES_DIVERGENTES`.
 *
 * Extrait du composant pour rester testable sans DOM ni Recharts (le dépôt
 * n'a pas de bibliothèque de test React) — même patron que
 * `lib/campagne/avancement.ts` pour `BandeauAvancement`/`CoutEtRythme`.
 */
import { BORNES_DIVERGENTES, LIBELLES_TRANCHES } from './palette-divergente'
import { formaterNombre } from '@/lib/format/nombre'

/** Une unité rendue par `GET .../alignement/maille` (Tâche 6) — région ou département. */
export interface UniteAlignement {
  code: string | null
  nom: string | null
  impressions: number
  spend: number | null
  cpm: number | null
  plan: number | null
  ecart_pct: number | null
  hors_plan: boolean
  volume_deplace: number
}

/** Une tranche rendue par `alignement_dispersion_cp` (sql/165). */
export interface TrancheDispersion {
  borne_basse: number | null
  borne_haute: number | null
  n_cp: number
  impressions: number
}

/** Une barre prête à afficher : position fixée dans l'échelle divergente (0-6). */
export interface BarreDispersion {
  index: number
  libelle: string
  borne_basse: number | null
  borne_haute: number | null
  n_cp: number
  impressions: number
}

/**
 * Les CP à plan nul (aucun écart définissable — voir sql/165, même trou de
 * donnée que T6-3) : tenus À PART, jamais fondus dans une des 7 bandes ni
 * perdus. Au composant de décider de les montrer (note, pas une barre —
 * ils n'ont pas de position sur un axe « écart au plan »).
 */
export interface HorsPlanDispersion {
  n_cp: number
  impressions: number
}

/**
 * Position (0-6) d'une paire de bornes dans l'échelle divergente, ou `null`
 * si la tranche est celle des CP hors plan (les deux bornes valent `null`).
 * Dérivée de `BORNES_DIVERGENTES` — jamais retypée.
 */
export function indexTranche(borneBasse: number | null, borneHaute: number | null): number | null {
  if (borneBasse === null && borneHaute === null) return null
  if (borneBasse === null) return 0
  const i = BORNES_DIVERGENTES.indexOf(borneBasse as (typeof BORNES_DIVERGENTES)[number])
  if (i === -1) return null // borne inconnue : donnée inattendue, ne pas deviner une position
  return i + 1
}

/**
 * Sépare les 7 bandes numérotées de la ligne hors plan. Ordonne les barres
 * par position croissante (l'ordre du payload n'est pas garanti côté
 * consommateur, même si la RPC trie déjà `order by c.tranche nulls last`).
 */
export function preparerDispersion(
  tranches: TrancheDispersion[],
): { barres: BarreDispersion[]; horsPlan: HorsPlanDispersion | null } {
  const barres: BarreDispersion[] = []
  // Accumulateurs SCALAIRES plutôt qu'un objet réaffecté : `let horsPlan:
  // HorsPlanDispersion | null = null` dont la seule affectation se lit
  // elle-même est inférée circulairement, et tsc la réduit à `never`
  // (« Property 'n_cp' does not exist on type 'never' »).
  let horsPlanCp = 0
  let horsPlanImps = 0
  let aDuHorsPlan = false

  for (const t of tranches) {
    const index = indexTranche(t.borne_basse, t.borne_haute)
    if (index === null) {
      // CUMUL, jamais écrasement : `alignement_dispersion_cp` n'émet qu'une
      // tranche à bornes nulles (`group by width_bucket`), mais la fonction
      // dont la raison d'être est de NE PAS perdre les CP hors plan ne peut
      // pas reposer sur cette hypothèse. Trois lignes, et l'hypothèse tombe.
      aDuHorsPlan = true
      horsPlanCp += t.n_cp
      horsPlanImps += t.impressions
      continue
    }
    barres.push({
      index,
      libelle: LIBELLES_TRANCHES[index],
      borne_basse: t.borne_basse,
      borne_haute: t.borne_haute,
      n_cp: t.n_cp,
      impressions: t.impressions,
    })
  }

  barres.sort((a, b) => a.index - b.index)
  const horsPlan: HorsPlanDispersion | null = aDuHorsPlan
    ? { n_cp: horsPlanCp, impressions: horsPlanImps }
    : null
  return { barres, horsPlan }
}

/** « -50 % et moins », « -25 % à -10 % », « +50 % et plus »… Bornes ouvertes aux extrémités. */
export function formaterPlageTranche(borneBasse: number | null, borneHaute: number | null): string {
  if (borneBasse === null && borneHaute !== null) return `${formaterNombre(borneHaute)} % et moins`
  if (borneHaute === null && borneBasse !== null) return `${formaterNombre(borneBasse)} % et plus`
  if (borneBasse !== null && borneHaute !== null) {
    return `${formaterNombre(borneBasse)} % à ${formaterNombre(borneHaute)} %`
  }
  return 'hors plan'
}

/** Un point de la courbe plan/réel : une région ou un département. */
export interface PointCourbe {
  code: string
  nom: string
  plan: number
  reel: number
  ecart_pct: number | null
  /** Base de l'aire empilée : le plus petit des deux, jamais colorée. */
  min: number
  /** Épaisseur de la bande sous-pression (0 si `reel >= plan`), empilée sur `min`. */
  gapSous: number
  /** Épaisseur de la bande sur-pression (0 si `reel <= plan`), empilée sur `min`. */
  gapSur: number
}

/**
 * Nombre d'unités affichées sur la courbe. Fixe par maille (mockup) — au-delà,
 * une courbe à trop de points redevient illisible, la raison même pour
 * laquelle la maille CP en change de forme.
 */
export const LIMITE_COURBE: Record<'region' | 'departement', number> = {
  region: 12,
  departement: 26,
}

/**
 * Une unité qui a reçu du volume sans qu'aucun plan ne l'attende. C'est le
 * signal le plus pur de la sur-pression — et celui qui disparaissait.
 *
 * `hors_plan` est posé par la RPC (`part_plan = 0 and reel > 0`) ; le second
 * terme n'est qu'une ceinture pour un payload qui aurait perdu le drapeau
 * mais gardé un plan nul et des impressions.
 */
function estHorsPlan(u: UniteAlignement): boolean {
  return (u.hors_plan || (u.plan ?? 0) <= 0) && u.impressions > 0
}

/**
 * Construit la série de la courbe : triée par plan décroissant (les unités
 * les plus lourdes du plan d'abord — même lecture que le mock), bornée à
 * `LIMITE_COURBE[maille]`.
 *
 * ── Les unités hors plan ont des PLACES RÉSERVÉES ────────────────────────
 * Le commentaire de cette fonction promettait déjà « n'exclut PAS les unités
 * hors plan : une unité qui reçoit du volume sans plan est un signal, pas un
 * CP à cacher ». Le code faisait l'inverse, et de façon systématique : une
 * unité hors plan a `plan = 0`, le tri par plan décroissant la rangeait donc
 * en toute dernière position et le `slice(0, limite)` la coupait dès qu'il y
 * avait plus de 26 unités (département) ou 12 (région).
 *
 * Mesuré sur la campagne démo : `alignement_par_maille(maille='departement')`
 * rend 100 départements dont **7 hors plan**, et les 7 ont plus de 26
 * départements au-dessus d'eux par `plan` — aucun n'atteignait jamais la
 * courbe. C'est la QUATRIÈME fois que les unités sans plan se perdent sur ce
 * chantier, et la première où le code affirmait par écrit faire le contraire.
 *
 * La sélection réserve donc des places : toutes les unités hors plan sont
 * gardées tant qu'elles ne dépassent pas la MOITIÉ du plafond (au-delà, les
 * plus volumineuses, sinon la courbe ne raconterait plus que celles-là et
 * perdrait la lecture du plan qui est sa raison d'être). L'ordre d'affichage
 * ne change pas : plan décroissant, donc les hors-plan en fin de courbe —
 * visibles, à leur place de lecture.
 */
export function construireSeriesCourbe(
  unites: UniteAlignement[],
  maille: 'region' | 'departement',
): PointCourbe[] {
  const limite = LIMITE_COURBE[maille]

  const horsPlan = unites.filter(estHorsPlan)
    .sort((a, b) => (b.volume_deplace || b.impressions) - (a.volume_deplace || a.impressions))
  const avecPlan = unites.filter((u) => !estHorsPlan(u))
    .sort((a, b) => (b.plan ?? 0) - (a.plan ?? 0))

  // Au moins la moitié du plafond leur est réservée — davantage si les unités
  // au plan ne suffisent pas à remplir la courbe.
  const nHorsPlan = Math.min(
    horsPlan.length,
    Math.max(Math.floor(limite / 2), limite - avecPlan.length),
  )
  const nAvecPlan = Math.min(avecPlan.length, Math.max(0, limite - nHorsPlan))

  return [...avecPlan.slice(0, nAvecPlan), ...horsPlan.slice(0, nHorsPlan)]
    .sort((a, b) => (b.plan ?? 0) - (a.plan ?? 0))
    .map((u) => {
      const plan = u.plan ?? 0
      const reel = u.impressions
      return {
        code: u.code ?? '—',
        nom: u.nom ?? u.code ?? '—',
        plan,
        reel,
        ecart_pct: u.ecart_pct,
        min: Math.min(plan, reel),
        gapSous: Math.max(0, plan - reel),
        gapSur: Math.max(0, reel - plan),
      }
    })
}

/**
 * Les `max` éléments les plus déréglés (plus grand `|ecart_pct|`), pour
 * annotation. Tout étiqueter rend un graphique — ou une carte — illisible :
 * la raison même de cette sélection (spec Tâche 12). Les éléments sans écart
 * définissable (`ecart_pct === null`, hors plan) ne peuvent pas être classés
 * par écart : exclus de la sélection, jamais annotés à zéro.
 *
 * Générique (Tâche 13B) : au départ spécifique à `PointCourbe` (courbe
 * plan/réel de `GraphiqueEcart`), généralisée à tout ce qui porte un
 * `ecart_pct` pour servir aussi l'annotation des zones les plus déréglées de
 * `DiffusionMapLayer` (`lib/campagne/diffusion-carte.ts`) sur des features
 * géométriques — même sélection, même tri, un seul endroit qui les définit.
 * Signature compatible : `selectionnerAnnotations(serie)` (Tâche 12,
 * `GraphiqueEcart.tsx`) infère toujours `T = PointCourbe` sans changement.
 */
export function selectionnerAnnotations<T extends { ecart_pct: number | null }>(
  points: readonly T[],
  max = 5,
): (T & { ecart_pct: number })[] {
  return points
    .filter((p): p is T & { ecart_pct: number } => p.ecart_pct !== null)
    .slice()
    .sort((a, b) => Math.abs(b.ecart_pct) - Math.abs(a.ecart_pct))
    .slice(0, max)
}
