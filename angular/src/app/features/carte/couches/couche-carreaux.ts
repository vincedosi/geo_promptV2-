import type maplibregl from 'maplibre-gl';
import { PLANCHER_LOG, palierEchelle, type BornesEchelle } from '../logique/carreaux/bornes';
import { bornesInternes, donneeExploitableExpr, hauteurExtrusionExpr } from '../logique/carreaux/expressions';
import { denominateurDe } from '../logique/carreaux/normalisation';
import { CARREAUX_PALETTES } from '../logique/palettes-donnees-carte';

/**
 * La couche des carreaux Filosofi — fonctions PURES sur l'instance MapLibre, testées sur la carte factice
 * (même patron que `risques/cartes/couches-zones.ts`, lot 3). Portage de `useMapInit.ts:924-975` (la source et ses
 * trois couches) et de `useMapLayers.ts:56-83, 290-593` (couleur, opacité, filtre par palier, hauteur 3D).
 *
 * ── COULEURS ─────────────────────────────────────────────────────────────
 * Les couleurs de DONNÉES (les six arrêts de chaque palette) viennent de `CARREAUX_PALETTES` = `PALETTES_DONNEES`
 * du lot 3 (exception A10/B12, identiques dans les deux thèmes). Les couleurs d'INTERFACE — le gris d'une donnée
 * absente et le trait de grille — sont des jetons lus par `CouleursService` (`JETONS_CARREAUX`), jamais un `var()`
 * ni un hexadécimal dans `paint` : `addLayer` lèverait, ou la couleur ne suivrait pas `jetons.css`.
 * React posait d'abord `#FC9272` puis repeignait ; ici la couche naît avec sa vraie expression.
 */
export const SOURCE_CARREAUX = 'carreaux-mvt';
export const COUCHE_CARREAUX_FOND = 'carreaux-mvt-fill';
export const COUCHE_CARREAUX_RELIEF = 'carreaux-mvt-extrusion';
export const COUCHE_CARREAUX_TRAIT = 'carreaux-mvt-line';
/** Opacité du trait de grille (`useMapInit.ts:972`, `useMapLayers.ts:302,459`). */
export const OPACITE_TRAIT = 0.35;
/** Opacité de l'extrusion — NON data-driven dans MapLibre : le filtre par palier ne s'y applique pas (`useMapInit.ts:952`). */
export const OPACITE_RELIEF = 0.85;
/** Nombre de paliers de la légende et de la couleur. */
export const N_PALIERS = 6;

/** Les jetons d'interface de la couche, lus par `CouleursService.palette`. */
export const JETONS_CARREAUX = { absente: 'donnee-absente', trait: 'carreaux-contour' } as const;
export type CouleursCarreaux = Record<keyof typeof JETONS_CARREAUX, string>;

/** La surface de MapLibre que la couche emploie. */
export type CarteCarreaux = Pick<
  maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'setPaintProperty' | 'setLayoutProperty'
>;

/**
 * Le quotient `indicateur / dénominateur` (`useMapLayers.ts:56-62`) : `max(dénominateur, 0.0001)` protège la division,
 * et c'est la SEULE lecture de la valeur — couleur, filtre par palier et hauteur passent par elle.
 */
export function carreauxNormaliseExpr(ind: string): unknown[] {
  const denom = denominateurDe(ind);
  return ['/', ['to-number', ['get', ind], 0], ['max', ['to-number', ['get', denom], 0], 0.0001]];
}

/** Le log10 du quotient, planché à `PLANCHER_LOG` (`useMapLayers.ts:79-83`) : le point d'entrée UNIQUE de l'échelle. */
export function carreauxEchelleExpr(ind: string): unknown[] {
  return ['log10', ['max', carreauxNormaliseExpr(ind), PLANCHER_LOG]];
}

/**
 * La couleur (`applyCarreauxColor`, `useMapLayers.ts:324-371`) : un `step` sur les frontières de `bornesInternes` —
 * l'unique découpage, aussi lu par la légende et le filtre par palier — derrière un `case` qui peint en gris neutre
 * une donnée absente. `null` sur une étendue nulle : MapLibre rejetterait l'expression EN SILENCE.
 */
export function expressionCouleur(ind: string, paletteId: string, bornes: BornesEchelle, grisAbsent: string): unknown[] | null {
  if (bornes.max - bornes.min <= 0) return null;
  const pal = CARREAUX_PALETTES.find((p) => p.id === paletteId) ?? CARREAUX_PALETTES[0];
  const frontieres = bornesInternes(bornes, N_PALIERS);
  return ['case',
    donneeExploitableExpr(ind, denominateurDe(ind)),
    ['step', carreauxEchelleExpr(ind), pal.stops[0], ...frontieres.flatMap((b, i) => [b, pal.stops[i + 1]])],
    grisAbsent,
  ];
}

/**
 * L'opacité, avec le filtre par palier de la légende (`applyBucketOpacity`, `useMapLayers.ts:449-484`) : un `case`
 * sur `fill-opacity` et non un `setFilter` (celui-ci s'évalue dans le worker et y rejette les valeurs nulles).
 * Le palier 0 est ouvert vers le bas et le palier 5 vers le haut, comme la couleur.
 */
export function expressionsOpacite(
  ind: string, bornes: BornesEchelle | null, seau: number | null, opacite: number,
): { fond: unknown; trait: unknown } {
  if (seau === null || !bornes) return { fond: opacite, trait: OPACITE_TRAIT };
  const { min, max } = palierEchelle(bornes, seau, N_PALIERS);
  const val = carreauxEchelleExpr(ind);
  const dans = seau === 0 ? ['<', val, max] : seau === N_PALIERS - 1 ? ['>=', val, min] : ['all', ['>=', val, min], ['<', val, max]];
  return { fond: ['case', dans, opacite, 0], trait: ['case', dans, OPACITE_TRAIT, 0] };
}

/** La hauteur 3D, en MULTIPLES DE LA MAILLE et non en mètres (`applyCarreauxHauteur`, `useMapLayers.ts:406-421`). */
export function expressionHauteur(ind: string, bornes: BornesEchelle, exageration: number): unknown[] | null {
  if (bornes.max - bornes.min <= 0) return null;
  return hauteurExtrusionExpr(ind, denominateurDe(ind), bornes, exageration, carreauxEchelleExpr(ind));
}

/** Les deux couches jumelles ne sont JAMAIS visibles ensemble : coplanaires à la base, elles se battraient (z-fighting). */
export function visibilites(visible: boolean, relief: boolean): { fond: 'visible' | 'none'; relief: 'visible' | 'none' } {
  return { fond: visible && !relief ? 'visible' : 'none', relief: visible && relief ? 'visible' : 'none' };
}

/** Ce que la couche porte à sa création — les réglages courants du service. */
export interface PeintureCarreaux {
  couleur: unknown[] | null;
  opacite: { fond: unknown; trait: unknown };
  hauteur: unknown[] | null;
  trait: string;
  visible: boolean;
  relief: boolean;
}

/**
 * Pose la source et ses trois couches (`useMapInit.ts:924-975`), IDEMPOTENT : chaque ajout teste l'instance
 * COURANTE, jamais un drapeau gardé hors d'elle — une carte recréée par un changement de fond n'a plus rien.
 * `minzoom: 4` et non 6 : sous son minzoom, MapLibre ne DEMANDE pas les tuiles.
 */
export function poserCouchesCarreaux(carte: CarteCarreaux, urlTuiles: string, p: PeintureCarreaux): void {
  const v = visibilites(p.visible, p.relief);
  if (!carte.getSource(SOURCE_CARREAUX)) {
    carte.addSource(SOURCE_CARREAUX, {
      type: 'vector', tiles: [urlTuiles], minzoom: 4, maxzoom: 14, attribution: 'INSEE, Filosofi 2019',
    });
  }
  if (!carte.getLayer(COUCHE_CARREAUX_FOND)) {
    const paint: Record<string, unknown> = { 'fill-opacity': p.opacite.fond };
    if (p.couleur) paint['fill-color'] = p.couleur;
    carte.addLayer({
      id: COUCHE_CARREAUX_FOND, type: 'fill', source: SOURCE_CARREAUX, 'source-layer': 'carreaux', minzoom: 4,
      paint, layout: { visibility: v.fond },
    } as maplibregl.LayerSpecification);
  }
  if (!carte.getLayer(COUCHE_CARREAUX_RELIEF)) {
    const paint: Record<string, unknown> = {
      'fill-extrusion-opacity': OPACITE_RELIEF, 'fill-extrusion-height': p.hauteur ?? 0, 'fill-extrusion-base': 0,
    };
    if (p.couleur) paint['fill-extrusion-color'] = p.couleur;
    carte.addLayer({
      id: COUCHE_CARREAUX_RELIEF, type: 'fill-extrusion', source: SOURCE_CARREAUX, 'source-layer': 'carreaux', minzoom: 4,
      paint, layout: { visibility: v.relief },
    } as maplibregl.LayerSpecification);
  }
  if (!carte.getLayer(COUCHE_CARREAUX_TRAIT)) {
    carte.addLayer({
      id: COUCHE_CARREAUX_TRAIT, type: 'line', source: SOURCE_CARREAUX, 'source-layer': 'carreaux', minzoom: 9,
      paint: {
        'line-color': p.trait,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.05, 10, 0.1, 12, 0.3, 14, 0.8],
        'line-opacity': p.opacite.trait,
      },
      layout: { visibility: v.fond },
    } as maplibregl.LayerSpecification);
  }
}

/** `setPaintProperty` qui ne lève jamais : une couche absente (carte en cours de recréation) n'est pas une erreur. */
export function peindre(carte: CarteCarreaux, couche: string, propriete: string, valeur: unknown): void {
  if (!carte.getLayer(couche)) return;
  try { carte.setPaintProperty(couche, propriete, valeur); } catch { /* couche retirée entre-temps */ }
}

/** Visibilité des trois couches. */
export function montrerCouchesCarreaux(carte: CarteCarreaux, visible: boolean, relief: boolean): void {
  const v = visibilites(visible, relief);
  for (const [couche, vis] of [[COUCHE_CARREAUX_FOND, v.fond], [COUCHE_CARREAUX_TRAIT, v.fond], [COUCHE_CARREAUX_RELIEF, v.relief]] as const) {
    if (carte.getLayer(couche)) carte.setLayoutProperty(couche, 'visibility', vis);
  }
}
