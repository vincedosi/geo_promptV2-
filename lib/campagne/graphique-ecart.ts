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
  let horsPlan: HorsPlanDispersion | null = null

  for (const t of tranches) {
    const index = indexTranche(t.borne_basse, t.borne_haute)
    if (index === null) {
      horsPlan = { n_cp: t.n_cp, impressions: t.impressions }
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
 * Construit la série de la courbe : triée par plan décroissant (les unités
 * les plus lourdes du plan d'abord — mêmes lecture que le mock), bornée à
 * `LIMITE_COURBE[maille]`. N'exclut PAS les unités hors plan : une unité qui
 * reçoit du volume sans plan est un signal, pas un CP à cacher.
 */
export function construireSeriesCourbe(
  unites: UniteAlignement[],
  maille: 'region' | 'departement',
): PointCourbe[] {
  const limite = LIMITE_COURBE[maille]
  return unites
    .slice()
    .sort((a, b) => (b.plan ?? 0) - (a.plan ?? 0))
    .slice(0, limite)
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
 * Les `max` points les plus déréglés (plus grand `|ecart_pct|`), pour
 * annotation sur la courbe. Tout étiqueter rend un graphique illisible — la
 * raison même de cette sélection (spec Tâche 12). Les unités sans écart
 * définissable (`ecart_pct === null`, hors plan) ne peuvent pas être
 * classées par écart : exclues de la sélection, jamais annotées à zéro.
 */
export function selectionnerAnnotations(points: PointCourbe[], max = 5): PointCourbe[] {
  return points
    .filter((p): p is PointCourbe & { ecart_pct: number } => p.ecart_pct !== null)
    .slice()
    .sort((a, b) => Math.abs(b.ecart_pct) - Math.abs(a.ecart_pct))
    .slice(0, max)
}
