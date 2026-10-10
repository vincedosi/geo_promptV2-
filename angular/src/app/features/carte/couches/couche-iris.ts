import type maplibregl from 'maplibre-gl';
import { bornesInternes, hauteurExtrusionExpr } from '../logique/carreaux/expressions';
import { type BornesIris, donneeIrisExploitableExpr, echelleDe, echelleLogExpr } from '../logique/iris-echelle';
import { IRIS_PALETTES } from '../logique/palettes-donnees-carte';
import { IRIS_ZOOM_PLANCHER } from '../logique/versions';
import { avantDe } from '../logique/ordre-couches';

/**
 * La couche des IRIS — fonctions PURES sur l'instance MapLibre, testées sur la carte factice (même patron que
 * `couche-carreaux.ts`). Portage de `useMapInit.ts:835-907` (la source `iris-source` et ses trois couches) et de
 * `useMapLayers.ts:617-806` (couleur, hauteur, opacité, filtre « vrais IRIS »).
 *
 * ── LA CASCADE ───────────────────────────────────────────────────────────
 * `get_iris_tile` (sql/139) sert des DÉPARTEMENTS sous z7, des COMMUNES à z7-z8 et des IRIS au-delà ; chaque entité
 * porte `niveau`. Sous `IRIS_ZOOM_PLANCHER`, MapLibre ne demande AUCUNE tuile et n'émet aucune erreur : la source et
 * les trois couches portent ce plancher, et c'est le service qui remonte la caméra à l'allumage.
 *
 * ── COULEURS ─────────────────────────────────────────────────────────────
 * Les arrêts de DONNÉES viennent d'`IRIS_PALETTES` (exception B12, identiques dans les deux thèmes). Le gris d'une
 * donnée absente et le contour sont des JETONS (`JETONS_IRIS`), lus par `CouleursService` — jamais `var()` ni un
 * hexadécimal recopié dans `paint`.
 */
export const SOURCE_IRIS = 'iris-source';
export const COUCHE_IRIS_FOND = 'iris-fill';
export const COUCHE_IRIS_TRAIT = 'iris-border';
export const COUCHE_IRIS_RELIEF = 'iris-extrusion';
/** Opacité de l'extrusion — non data-driven dans MapLibre (`useMapInit.ts:899`). */
export const OPACITE_RELIEF_IRIS = 0.85;
/**
 * La couleur PROVISOIRE de la couche, avant l'arrivée des bornes : `#4292C6` de `useMapInit.ts:864` — le quatrième
 * arrêt de la palette `bleu`, lu dans la palette plutôt que recopié.
 */
export const COULEUR_PROVISOIRE_IRIS = IRIS_PALETTES[0].stops[3];

/** Les jetons d'interface de la couche. */
export const JETONS_IRIS = { absente: 'donnee-absente', trait: 'iris-contour' } as const;
export type CouleursIris = Record<keyof typeof JETONS_IRIS, string>;

/** La surface de MapLibre que la couche emploie. */
export type CarteIris = Pick<
  maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'setPaintProperty' | 'setLayoutProperty' | 'setFilter'
>;

/**
 * Largeur du contour : les arrêts couvrent toute la cascade — un contour de département à z5 plus fin qu'un contour
 * d'IRIS à z14 (`useMapInit.ts:876`).
 */
export const LARGEUR_TRAIT_IRIS = ['interpolate', ['linear'], ['zoom'], 4, 0.2, 7, 0.3, 12, 0.6, 14, 1.2];
/** Opacité du contour tant que l'opacité n'a pas été réglée (`useMapInit.ts:877`). */
export const OPACITE_TRAIT_IRIS = ['interpolate', ['linear'], ['zoom'], 4, 0.35, 7, 0.35, 12, 0.5, 14, 0.6];

/**
 * Couleur de la choroplèthe (`applyIrisColor`, `useMapLayers.ts:617-636`) : un `step` sur l'échelle NATIONALE, en log10
 * de la valeur NORMALISÉE, derrière un `case` qui peint une donnée absente en gris neutre (« on ne sait pas » n'est
 * pas « personne ici »). Les frontières sont `bornesInternes` — celles que la légende affiche.
 */
export function expressionCouleurIris(bornes: BornesIris, paletteId: string, grisAbsent: string): unknown[] {
  const pal = IRIS_PALETTES.find((p) => p.id === paletteId) ?? IRIS_PALETTES[0];
  const frontieres = bornesInternes(echelleDe(bornes), pal.stops.length);
  return [
    'case',
    donneeIrisExploitableExpr(bornes.colonne, bornes.classe),
    ['step', echelleLogExpr(bornes), pal.stops[0], ...frontieres.flatMap((v, i) => [v, pal.stops[i + 1]])],
    grisAbsent,
  ];
}

/**
 * Hauteur 3D (`applyIrisHauteur`, `useMapLayers.ts:650-667`) : la MÊME expression que les carreaux, en multiples de la
 * maille déduite de `superficie_km2`, sur la même échelle que la couleur.
 */
export function expressionHauteurIris(bornes: BornesIris, exageration: number): unknown[] {
  return hauteurExtrusionExpr(
    bornes.colonne,
    bornes.classe === 'effectif' ? 'superficie_km2' : bornes.colonne,
    echelleDe(bornes),
    exageration,
    echelleLogExpr(bornes),
  );
}

/**
 * Filtre « Vrais IRIS uniquement » (`useMapLayers.ts:787-806`), recopié : `is_true_iris` n'existe QU'AU palier IRIS
 * de la cascade — filtrer dessus sans condition viderait la carte dès qu'on s'éloigne. `null` = aucun filtre.
 */
export function filtreVraisIris(vraisSeulement: boolean): unknown[] | null {
  return vraisSeulement
    ? ['any', ['!=', ['get', 'niveau'], 'iris'], ['==', ['get', 'is_true_iris'], true]]
    : null;
}

/**
 * Opacité du contour : l'interpolation par zoom de `useMapInit` tant que l'opacité n'a pas été touchée, puis
 * `min(v × 0,8 ; 0,6)` (`setIrisOpacity`, `useMapLayers.ts:751`) dès le premier réglage.
 */
export function opaciteTraitIris(opacite: number, reglee: boolean): unknown {
  return reglee ? Math.min(opacite * 0.8, 0.6) : OPACITE_TRAIT_IRIS;
}

/** Plat et relief ne coexistent JAMAIS : coplanaires à la base, ils se battraient (`useMapLayers.ts:772-785`). */
export function visibilitesIris(visible: boolean, relief: boolean): { plat: 'visible' | 'none'; relief: 'visible' | 'none' } {
  return { plat: visible && !relief ? 'visible' : 'none', relief: visible && relief ? 'visible' : 'none' };
}

/** Ce que la couche porte à sa création — les réglages courants du service. */
export interface PeintureIris {
  couleur: unknown;
  opacite: number;
  traitOpacite: unknown;
  hauteur: unknown;
  trait: string;
  filtre: unknown[] | null;
  visible: boolean;
  relief: boolean;
}

/**
 * Pose la source et ses trois couches (`useMapInit.ts:851-907`), IDEMPOTENT : chaque ajout teste l'instance COURANTE.
 * Chacune s'insère à SA place dans l'ordre de React (`avantDe`, `logique/ordre-couches.ts`, T8) : SOUS les carreaux, et
 * AU-DESSUS des POI rendus par MapLibre (`useMapInit.ts` pose les POI en premier).
 */
export function poserCouchesIris(carte: CarteIris, urlTuiles: string, p: PeintureIris): void {
  const v = visibilitesIris(p.visible, p.relief);
  if (!carte.getSource(SOURCE_IRIS)) {
    carte.addSource(SOURCE_IRIS, {
      type: 'vector', tiles: [urlTuiles], minzoom: IRIS_ZOOM_PLANCHER, maxzoom: 14, attribution: 'IGN — IRIS 2023',
    });
  }
  const filtre = p.filtre ? { filter: p.filtre } : {};
  if (!carte.getLayer(COUCHE_IRIS_FOND)) {
    carte.addLayer({
      id: COUCHE_IRIS_FOND, type: 'fill', source: SOURCE_IRIS, 'source-layer': 'iris', minzoom: IRIS_ZOOM_PLANCHER,
      paint: { 'fill-color': p.couleur, 'fill-opacity': p.opacite }, layout: { visibility: v.plat }, ...filtre,
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_IRIS_FOND));
  }
  if (!carte.getLayer(COUCHE_IRIS_TRAIT)) {
    carte.addLayer({
      id: COUCHE_IRIS_TRAIT, type: 'line', source: SOURCE_IRIS, 'source-layer': 'iris', minzoom: IRIS_ZOOM_PLANCHER,
      paint: { 'line-color': p.trait, 'line-width': LARGEUR_TRAIT_IRIS, 'line-opacity': p.traitOpacite },
      layout: { visibility: v.plat }, ...filtre,
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_IRIS_TRAIT));
  }
  if (!carte.getLayer(COUCHE_IRIS_RELIEF)) {
    carte.addLayer({
      id: COUCHE_IRIS_RELIEF, type: 'fill-extrusion', source: SOURCE_IRIS, 'source-layer': 'iris', minzoom: IRIS_ZOOM_PLANCHER,
      paint: {
        'fill-extrusion-color': p.couleur, 'fill-extrusion-opacity': OPACITE_RELIEF_IRIS,
        'fill-extrusion-height': p.hauteur, 'fill-extrusion-base': 0,
      },
      layout: { visibility: v.relief }, ...filtre,
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_IRIS_RELIEF));
  }
}

/** Visibilité des trois couches. */
export function montrerCouchesIris(carte: CarteIris, visible: boolean, relief: boolean): void {
  const v = visibilitesIris(visible, relief);
  for (const [couche, vis] of [[COUCHE_IRIS_FOND, v.plat], [COUCHE_IRIS_TRAIT, v.plat], [COUCHE_IRIS_RELIEF, v.relief]] as const) {
    if (carte.getLayer(couche)) carte.setLayoutProperty(couche, 'visibility', vis);
  }
}

/** Le filtre « vrais IRIS » sur les trois couches. */
export function filtrerCouchesIris(carte: CarteIris, filtre: unknown[] | null): void {
  for (const couche of [COUCHE_IRIS_FOND, COUCHE_IRIS_TRAIT, COUCHE_IRIS_RELIEF]) {
    if (carte.getLayer(couche)) carte.setFilter(couche, filtre as maplibregl.FilterSpecification | null);
  }
}
