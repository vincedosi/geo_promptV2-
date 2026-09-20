/**
 * Logique pure des trois vignettes carte du Suivi V2 (Tâche 13A) :
 * types du payload de la route `.../alignement/maille/map` (RPC
 * `alignement_par_maille_geo`, sql/165), construction des classes de
 * l'échelle séquentielle (quantiles) et des expressions de peinture MapLibre
 * — testable sans React ni MapLibre (ce dépôt n'a pas de bibliothèque de
 * test React).
 *
 * PIÈGE (task-13-brief.md) : un `step`/`interpolate` MapLibre à bornes NON
 * strictement croissantes est rejeté EN SILENCE — aucune erreur, aucune
 * couche. `expressionEtapes` vérifie la stricte croissance et lève une
 * exception explicite plutôt que de construire une expression muette.
 */
import type maplibregl from 'maplibre-gl'
import { formaterNombre, formaterNombreAbrege } from '@/lib/format/nombre'
import type { SourcePlan } from '@/lib/campagne/source-plan'

export type Maille = 'region' | 'departement' | 'cp'
/**
 * Les vignettes carte du Suivi.
 *
 * ⚠ `'plan'` et `'variable'` ne montrent PAS la même chose, et les confondre
 * est exactement le défaut que la Tâche de ce jour corrige :
 *   · `'variable'` montre l'INDICATEUR qui a servi à bâtir le plan ;
 *   · `'plan'` montre LA PART DU PLAN elle-même.
 * Un plan bâti sur un jeu de zones n'a aucun indicateur derrière lui — l'écran
 * repliait alors sur `abstention_pres_2022`, en titrant « la variable qui a
 * servi à bâtir le plan » une variable que personne n'avait choisie.
 */
export type TypeVignette = 'impressions' | 'variable' | 'plan' | 'alignement'

/**
 * Piège #3 (task-13-brief.md) : la valeur d'un CP s'applique à TOUTE sa zone,
 * quelle que soit la maille affichée — jamais de désagrégation sous le code
 * postal, la maille d'achat du DSP. Texte UNIQUE, partagé par `CarteVignette`
 * (Tâche 13A) et `DiffusionMapLayer` (Tâche 13B, carte plein écran) : une
 * règle que le brief qualifie de non négociable ne doit jamais être portée
 * par deux formulations qu'on pourrait laisser diverger.
 */
export const NOTE_MAILLE_CP = 'Valeur uniforme par code postal — la maille d\'achat du DSP.'

/**
 * Une zone agrégée avec sa géométrie, rendue par `alignement_par_maille_geo`.
 * `ecart_pct` et `variable_valeur` valent `null` quand la donnée manque
 * (respectivement : plan nul → `hors_plan`, ou variable non matérialisée
 * pour ce CP) — la géométrie reste présente : au client de griser plutôt que
 * de masquer (spec Tâche 13).
 */
export interface FeatureAlignementGeo {
  code: string | null
  nom: string | null
  impressions: number
  ecart_pct: number | null
  hors_plan: boolean
  variable_valeur: number | null
  /**
   * Part du plan de l'unité, en pourcentage du plan TOTAL de la campagne.
   *
   * ⚠ Toujours rapportée au périmètre complet, jamais au seul parent filtré
   * (sql/216, même ruling que T6-2) : sinon la somme des parts vaudrait 100
   * dans chaque drill-down, et aucun département ne pourrait plus apparaître
   * sous ou sur-livré.
   */
  part_plan_pct: number | null
  geometry: GeoJSON.Geometry
}

export interface ReponseAlignementMailleGeo {
  maille: Maille
  parent: string | null
  variable_code: string
  n_total: number
  features: FeatureAlignementGeo[]
  /** D'où vient le plan. Décide du titre ET de la valeur de la vignette du
   *  milieu — voir `lib/campagne/source-plan.ts`. */
  source_plan?: SourcePlan
}

/** Vraie ssi `bornes` est strictement croissant — condition requise par
 *  `step` ET `interpolate` en MapLibre (silencieusement rejetés sinon). */
export function bornesStrictementCroissantes(bornes: readonly number[]): boolean {
  return bornes.every((b, i) => i === 0 || b > bornes[i - 1])
}

/**
 * Bornes de classes (quantiles) d'un jeu de valeurs, pour l'échelle
 * séquentielle des vignettes Impressions / Variable du plan. Rend au plus
 * `nClasses - 1` bornes, STRICTEMENT croissantes — les valeurs manquantes
 * sont ignorées, les doublons de quantile (données peu variées) sont
 * dédupliqués plutôt que de produire une borne répétée (ce qui casserait
 * `expressionEtapes`).
 */
export function bornesQuantiles(valeurs: readonly number[], nClasses: number): number[] {
  const vals = valeurs.filter((v): v is number => Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (vals.length === 0 || nClasses < 2) return []
  const bornes: number[] = []
  for (let k = 1; k < nClasses; k++) {
    const idx = Math.min(vals.length - 1, Math.floor((k / nClasses) * vals.length))
    const b = vals[idx]
    if (bornes.length === 0 || b > bornes[bornes.length - 1]) bornes.push(b)
  }
  return bornes
}

/**
 * Échantillonne `nBornes + 1` teintes réparties uniformément dans une rampe
 * complète. Sert quand `bornesQuantiles` déduplique et rend moins de bornes
 * que prévu (données peu variées) : la rampe est raccourcie EN CONSERVANT
 * les teintes des deux extrémités plutôt que de prendre les `n` premières,
 * ce qui aplatirait le dégradé vers le bas de l'échelle.
 */
export function rampePourBornes(rampe: readonly string[], nBornes: number): string[] {
  const nCouleurs = nBornes + 1
  if (nCouleurs >= rampe.length) return [...rampe]
  if (nCouleurs <= 1) return [rampe[rampe.length - 1]]
  return Array.from({ length: nCouleurs }, (_, i) =>
    rampe[Math.round((i * (rampe.length - 1)) / (nCouleurs - 1))])
}

/**
 * Construit l'expression `fill-color` MapLibre : gris (`couleurAbsente`)
 * quand la propriété vaut `null` OU que `proprieteAbsence` vaut `true`
 * (ex. `hors_plan`), sinon un `step` sur `bornes`/`rampe`.
 *
 * Lève une erreur explicite si `bornes` n'est pas strictement croissant
 * (piège documenté en tête de fichier) ou si `rampe` n'a pas exactement
 * `bornes.length + 1` couleurs — mieux vaut planter au montage du composant
 * qu'une carte qui ne peint jamais rien.
 *
 * Ruling T15-3 (relecture Tâche 15) : `bornes` VIDE (aucune valeur finie —
 * un jeu de `features` pas encore chargé, ou un indicateur non matérialisé
 * sur tout le périmètre visible) est un cas ATTEIGNABLE sur cet écran, pas
 * seulement au tout premier rendu. Avant ce correctif, `bornes = []`
 * produisait un `step` à 3 éléments (`['step', get, couleurUnique]`, aucun
 * palier) — MapLibre le REJETTE au runtime (« Expected at least 4 arguments,
 * but found only 2 »), constaté à l'écran. La garde appelante (Tâche 15,
 * `SuiviV2`) protège le tout premier rendu ; celui-ci protège la fonction
 * elle-même, qui a précisément pour raison d'être de planter fort plutôt que
 * de construire une expression MapLibre muette (voir le fichier `CarteVignette.tsx`).
 * Sans palier, il n'y a qu'UNE couleur possible : l'expression devient une
 * simple couleur littérale, jamais un `step` vide.
 */
export function expressionEtapes(
  propriete: string,
  proprieteAbsence: string | null,
  bornes: readonly number[],
  rampe: readonly string[],
  couleurAbsente: string,
): maplibregl.ExpressionSpecification {
  if (!bornesStrictementCroissantes(bornes)) {
    throw new Error(
      `expressionEtapes: bornes non strictement croissantes pour « ${propriete} » (${JSON.stringify(bornes)})`,
    )
  }
  if (rampe.length !== bornes.length + 1) {
    throw new Error(
      `expressionEtapes: la rampe doit avoir bornes.length + 1 couleurs (${bornes.length + 1} attendues, ${rampe.length} reçues)`,
    )
  }

  let step: unknown
  if (bornes.length === 0) {
    // Une seule couleur possible — jamais un `step` à 0 palier (rejeté par
    // MapLibre au runtime, T15-3).
    step = rampe[0]
  } else {
    const s: unknown[] = ['step', ['get', propriete], rampe[0]]
    bornes.forEach((b, i) => { s.push(b, rampe[i + 1]) })
    step = s
  }

  const conditionAbsence = proprieteAbsence
    ? ['any', ['==', ['get', propriete], null], ['==', ['get', proprieteAbsence], true]]
    : ['==', ['get', propriete], null]

  return ['case', conditionAbsence, couleurAbsente, step] as unknown as maplibregl.ExpressionSpecification
}

/**
 * Enveloppe [xmin, ymin, xmax, ymax] de toutes les géométries — Polygon et
 * MultiPolygon uniquement (seuls types rendus par `alignement_par_maille_geo`).
 * `null` si aucune feature n'a de géométrie exploitable.
 */
/**
 * Enveloppe [xmin, ymin, xmax, ymax] d'UNE géométrie Polygon/MultiPolygon —
 * bloc élémentaire partagé par `enveloppeFeatures` (plusieurs features, cadrage
 * partagé des vignettes) et par `centreFeature` (Tâche 13B,
 * `lib/campagne/diffusion-carte.ts` : ancrage des étiquettes de zones
 * déréglées et centrage sur sélection de la carte Diffusion plein écran).
 * Extrait de `enveloppeFeatures` sans changement de comportement (Tâche 13B).
 */
export function enveloppeGeometrie(
  geometry: GeoJSON.Geometry | undefined,
): [number, number, number, number] | null {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity
  let has = false

  const visiter = (coords: unknown): void => {
    if (!Array.isArray(coords) || coords.length === 0) return
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const [x, y] = coords as [number, number]
      if (x < xmin) xmin = x
      if (y < ymin) ymin = y
      if (x > xmax) xmax = x
      if (y > ymax) ymax = y
      has = true
      return
    }
    for (const c of coords) visiter(c)
  }

  const geom = geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined
  if (geom && 'coordinates' in geom) visiter(geom.coordinates)

  return has ? [xmin, ymin, xmax, ymax] : null
}

export function enveloppeFeatures(
  features: readonly Pick<FeatureAlignementGeo, 'geometry'>[],
): [number, number, number, number] | null {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity
  let has = false

  for (const f of features) {
    const env = enveloppeGeometrie(f.geometry)
    if (!env) continue
    has = true
    if (env[0] < xmin) xmin = env[0]
    if (env[1] < ymin) ymin = env[1]
    if (env[2] > xmax) xmax = env[2]
    if (env[3] > ymax) ymax = env[3]
  }

  return has ? [xmin, ymin, xmax, ymax] : null
}

/**
 * Domaine [min, max] non-nul d'une propriété numérique — sert les
 * étiquettes d'extrémité de la légende (« faible »/« fort », ou la valeur
 * réelle min/max pour la vignette Variable du plan). `null` si aucune valeur.
 */
export function domaineValeurs(valeurs: readonly (number | null)[]): [number, number] | null {
  const vals = valeurs.filter((v): v is number => v !== null && Number.isFinite(v))
  if (vals.length === 0) return null
  return [Math.min(...vals), Math.max(...vals)]
}

/**
 * Étiquettes d'extrémité de la légende d'une vignette — micro-copie alignée
 * sur le mockup (`docs/DOC INTERFACE/magelian-suivi.html`) : qualitative pour
 * Impressions et Alignement, valeur réelle min/max pour la Variable du plan
 * (le domaine change avec l'indicateur sélectionné).
 */
export function libellesExtremites(
  type: TypeVignette,
  domaine: [number, number] | null,
): { finGauche: string; finDroite: string } {
  if (type === 'impressions') {
    return domaine
      ? { finGauche: formaterNombreAbrege(domaine[0]), finDroite: formaterNombreAbrege(domaine[1]) }
      : { finGauche: 'faible', finDroite: 'fort' }
  }
  if (type === 'variable') {
    return domaine
      ? { finGauche: formaterNombre(domaine[0]), finDroite: formaterNombre(domaine[1]) }
      : { finGauche: '—', finDroite: '—' }
  }
  if (type === 'plan') {
    // En POURCENTAGE du plan, et l'unité est écrite : une part de plan sans
    // son `%` se lirait comme un effectif.
    return domaine
      ? { finGauche: `${formaterNombre(domaine[0])} %`, finDroite: `${formaterNombre(domaine[1])} %` }
      : { finGauche: '—', finDroite: '—' }
  }
  return { finGauche: 'sous', finDroite: 'sur' }
}
