/**
 * @file lib/campagne/diffusion-carte.ts
 *
 * Logique pure de `app/map/_components/DiffusionMapLayer.tsx` (Tâche 13B) :
 * la carte plein écran « Diffusion » — pression réelle comparée au plan, sur
 * tout le territoire, échelle divergente
 * (`docs/DOC INTERFACE/PROMPT_OVERLAY_SUIVI_V2.md:101`). Testable sans DOM ni
 * MapLibre, même patron que `lib/campagne/vignette-carte.ts` (Tâche 13A) et
 * `lib/campagne/graphique-ecart.ts` (Tâche 12).
 *
 * Géométrie et échelle réutilisées telles quelles depuis la Tâche 13A —
 * `enveloppeGeometrie` (vignette-carte.ts), `expressionEtapes`/
 * `BORNES_DIVERGENTES`/`RAMPE_MAPLIBRE` (palette-divergente.ts, importés
 * directement par le composant) : aucune seconde source de géométrie, aucune
 * seconde échelle divergente.
 */
import { enveloppeGeometrie, type FeatureAlignementGeo } from './vignette-carte'
import { selectionnerAnnotations } from './graphique-ecart'

/** Un point d'ancrage d'étiquette — centre (bbox) d'une zone déréglée, prêt à
 *  devenir un point GeoJSON pour la couche `symbol` d'annotation de la carte
 *  Diffusion. */
export interface EtiquetteZone {
  code: string
  nom: string
  ecart_pct: number
  centre: [number, number]
}

/**
 * Centre [lon, lat] d'UNE feature — milieu de son enveloppe. Approximation
 * suffisante pour ancrer une étiquette ou centrer la caméra sur une zone (pas
 * un vrai centroïde pondéré par l'aire, qu'aucun consommateur de ce fichier
 * n'exige).
 */
export function centreFeature(
  feature: Pick<FeatureAlignementGeo, 'geometry'>,
): [number, number] | null {
  const env = enveloppeGeometrie(feature.geometry)
  if (!env) return null
  return [(env[0] + env[2]) / 2, (env[1] + env[3]) / 2]
}

/**
 * Libellé court d'une zone pour l'étiquette carte — `nom`, replié sur `code`
 * si absent (parité avec les départements « Hors région » de la Tâche 6,
 * PV-2, qui peuvent porter un nom sans code de région), tronqué pour ne pas
 * déborder sur une petite zone. Jamais vide : un point d'annotation sans
 * texte serait un repère affiché sans explication.
 */
export function libelleEtiquette(
  nom: string | null,
  code: string | null,
  max = 22,
): string {
  const texte = (nom && nom.trim()) || code || '—'
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte
}

/**
 * Les zones les plus déréglées à annoter sur la carte Diffusion (spec §2 :
 * « les zones les plus déréglées sont annotées », contrairement aux
 * vignettes — trop petites, Tâche 13A). Réutilise la sélection de
 * `lib/campagne/graphique-ecart.ts` (même tri par `|ecart_pct|` décroissant,
 * même exclusion des unités hors plan — un écart non définissable ne peut
 * pas être classé) puis résout un point d'ancrage géométrique : une zone
 * sélectionnée mais sans géométrie exploitable dans la bbox demandée (ruling
 * T13A-1 — tolérance de simplification dérivée de la bbox, zones hors
 * viewport potentiellement absentes) est silencieusement écartée de
 * l'annotation plutôt que de produire un point `null`.
 */
export function zonesAAnnoter(
  features: readonly FeatureAlignementGeo[],
  max = 6,
): EtiquetteZone[] {
  const deregles = selectionnerAnnotations(features, max)
  const etiquettes: EtiquetteZone[] = []
  for (const f of deregles) {
    const centre = centreFeature(f)
    if (!centre) continue
    etiquettes.push({
      code: f.code ?? '—',
      nom: libelleEtiquette(f.nom, f.code),
      ecart_pct: f.ecart_pct,
      centre,
    })
  }
  return etiquettes
}

/**
 * Formate une bbox `[west, south, east, north]` en paramètre de requête pour
 * `.../alignement/maille/map` — 3 décimales (~110 m), même précision que
 * `lib/meteo/requete.ts` pour cette famille de routes campagne. Sert aussi de
 * CLÉ de garde anti-refetch au `moveend` : deux viewports arrondis à la même
 * valeur ne redéclenchent pas de requête (patron `useRadioLayer.ts`).
 */
export function bboxVersParametre(bbox: readonly [number, number, number, number]): string {
  return bbox.map((v) => v.toFixed(3)).join(',')
}
