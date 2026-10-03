import type maplibregl from 'maplibre-gl';
import { LARGEUR_TRAIT_ZONE, TIRETE_ZONE_CALCULEE } from '../logique/nature-zone';
import { expressionOpaciteSelonZoom } from '../logique/opacites-zones';
import { NIVEAUX, type ProfilRayons, anneauxDuNiveau, libelleRayon } from '../logique/profil';
import { ZONES_RISQUE_ZOOM_DETAIL, ZONES_RISQUE_ZOOM_LISIBLE, ZONES_RISQUE_ZOOM_PLANCHER } from '../logique/zooms';

/**
 * Les couches de ZONES de la carte du module risque — portage de `CarteRisque.tsx:356-560`.
 *
 * Des fonctions et non un composant : elles ne font qu'agir sur une carte qu'on leur donne, ce qui les rend
 * testables sur la carte factice sans monter quoi que ce soit (`couches-zones.spec.ts`).
 *
 * ── TROIS RÉGIMES DE ZOOM ─────────────────────────────────────────────────
 *
 * - sous `ZONES_RISQUE_ZOOM_LISIBLE` (7) : RIEN n'est peint — une zone de 2 km y fait moins d'un pixel ; le
 *   composant affiche un bandeau. Les tuiles, elles, existent dès le plancher de la source (4).
 * - de 7 à `ZONES_RISQUE_ZOOM_DETAIL` (10) : un aplat UNI par niveau (`expressionOpaciteSelonZoom`, `step`),
 *   plus le contour plein des PPRT ;
 * - au-delà : chaque bande reprend son opacité, son contour TIRETÉ et l'étiquette de son rayon.
 *
 * ⚠ **Jamais `var()` dans `paint`** : `addLayer` LÈVE et la couche n'existe pas. Les teintes arrivent DÉJÀ
 * résolues par `CouleursService` (`TeintesZones`), jamais un hexadécimal recopié.
 */

export const SOURCE_ZONES = 'atelier-zones';
export const ID_FOND = 'atelier-zones-fond';
export const ID_CONTOUR = 'atelier-zones-contour';
export const ID_PPRT = 'atelier-zones-pprt';
export const ID_ETIQUETTES = 'atelier-zones-etiquettes';
/** Nom de la couche DANS la tuile : `ST_AsMVT(t, 'zones_risque', …)` (sql/205). */
export const COUCHE_TUILE = 'zones_risque';

/**
 * Toutes les couches servies par la source des zones.
 *
 * ⚠ Elles doivent être retirées AVANT la source, sinon `removeSource` lève — et l'ancienne source reste,
 * servant les tuiles du profil précédent sous la légende du nouveau (constaté côté React le 2026-09-21, une
 * couche d'étiquettes oubliée dans la liste). Une couche ajoutée ici sans y être déclarée produit ce défaut.
 */
export const COUCHES_ZONES = [ID_FOND, ID_CONTOUR, ID_PPRT, ID_ETIQUETTES] as const;

/** Les teintes résolues des zones : une par niveau, plus le halo des étiquettes (INVERSÉ entre thèmes). */
export interface TeintesZones {
  haut: string;
  bas: string;
  autres: string;
  halo: string;
}

export interface OptionsZones {
  /** Modèle d'adresse des tuiles (`ZonesRisqueApi.urlTuilesZones`), qui porte le profil et les natures. */
  url: string;
  teintes: TeintesZones;
  /** Le profil CALCULÉ : il fournit le libellé de rayon de chaque classe. */
  profil: ProfilRayons;
  /** Visibilité À LA CRÉATION (l'équivalent de `fusionnerRef` de React). La bascule passe par `basculerCouchesZones`. */
  visible: boolean;
}

/** La couleur d'une zone d'après sa propriété `niveau` (`expressionCouleurNiveau`, palette-zones-risque.ts). */
export function expressionCouleurNiveau(t: TeintesZones): unknown[] {
  return ['match', ['get', 'niveau'], 'haut', t.haut, 'bas', t.bas, 'autres', t.autres, t.autres];
}

/**
 * `classe` → le libellé de son rayon, pour l'étiquette portée par le contour.
 *
 * Construit depuis le PROFIL et non depuis la tuile : sql/205 n'y écrit pas le rayon, et l'y ajouter
 * imposerait de reconstruire le cache à chaque anneau déplacé. Le périmètre publié porte « PPRT » : sa forme
 * vient d'un arrêté, pas d'un cercle. Défaut vide : une classe inconnue n'écrit rien plutôt qu'un libellé
 * inventé — c'est le signe qu'un profil et une tuile divergent.
 */
export function expressionEtiquetteClasse(profil: ProfilRayons): unknown[] {
  const m: unknown[] = ['match', ['get', 'classe']];
  for (const n of NIVEAUX) {
    m.push(`${n}:pprt`, 'PPRT');
    anneauxDuNiveau(profil, n).forEach((r, i) => m.push(`${n}:${i + 1}`, libelleRayon(r)));
  }
  m.push('');
  return m;
}

/** Retire les quatre couches PUIS la source (l'ordre inverse lève). Sans effet sur une carte qui ne les porte pas. */
export function retirerCouchesZones(carte: maplibregl.Map): void {
  for (const id of COUCHES_ZONES) {
    if (carte.getLayer(id)) carte.removeLayer(id);
  }
  if (carte.getSource(SOURCE_ZONES)) carte.removeSource(SOURCE_ZONES);
}

/**
 * (Re)pose la source et ses quatre couches. La source porte le profil dans son URL : changer de profil impose
 * de la RECRÉER — MapLibre ne réécrit pas l'URL d'une source vectorielle, et la garder servirait les tuiles de
 * l'ancien profil sous la légende du nouveau. Appeler SEULEMENT quand le code change ; un changement de thème
 * passe par `repeindreCouchesZones`, qui ne redemande aucune tuile.
 */
export function poserCouchesZones(carte: maplibregl.Map, o: OptionsZones): void {
  retirerCouchesZones(carte);
  carte.addSource(SOURCE_ZONES, {
    type: 'vector',
    tiles: [o.url],
    minzoom: ZONES_RISQUE_ZOOM_PLANCHER,
    maxzoom: 14,
  });
  const couleur = expressionCouleurNiveau(o.teintes);
  const visibilite = o.visible ? 'visible' : 'none';

  // `minzoom` sur la COUCHE et pas sur la source : les tuiles existent dès z4, on ne peint qu'à partir de z7.
  carte.addLayer({
    id: ID_FOND,
    type: 'fill',
    source: SOURCE_ZONES,
    'source-layer': COUCHE_TUILE,
    minzoom: ZONES_RISQUE_ZOOM_LISIBLE,
    layout: { visibility: visibilite },
    paint: {
      'fill-color': couleur as never,
      // Aplat uni par niveau de loin, bandes détaillées de près.
      'fill-opacity': expressionOpaciteSelonZoom(ZONES_RISQUE_ZOOM_DETAIL) as never,
    },
  });

  // Tireté = zone CALCULÉE par nous, et seulement au DÉTAIL : sous ce zoom les anneaux sont fondus, leurs
  // contours y dessineraient des cernes entre des teintes identiques.
  carte.addLayer({
    id: ID_CONTOUR,
    type: 'line',
    source: SOURCE_ZONES,
    'source-layer': COUCHE_TUILE,
    minzoom: ZONES_RISQUE_ZOOM_DETAIL,
    filter: ['!=', ['get', 'bande'], null],
    layout: { visibility: visibilite },
    paint: {
      'line-color': couleur as never,
      'line-width': LARGEUR_TRAIT_ZONE,
      'line-dasharray': [...TIRETE_ZONE_CALCULEE] as never,
      'line-opacity': 0.9,
    },
  });

  // Plein = servitude PUBLIÉE par l'État, visible dès que les zones le sont : la fondre au dézoom effacerait
  // la distinction entre l'opposable et le calculé.
  carte.addLayer({
    id: ID_PPRT,
    type: 'line',
    source: SOURCE_ZONES,
    'source-layer': COUCHE_TUILE,
    minzoom: ZONES_RISQUE_ZOOM_LISIBLE,
    filter: ['==', ['get', 'bande'], null],
    layout: { visibility: visibilite },
    paint: {
      'line-color': couleur as never,
      'line-width': LARGEUR_TRAIT_ZONE + 0.5,
      'line-opacity': 1,
    },
  });

  // L'étiquette du rayon court le long du contour (`symbol-placement: line`) : posée au centre, celles des
  // bandes concentriques s'empileraient.
  carte.addLayer({
    id: ID_ETIQUETTES,
    type: 'symbol',
    source: SOURCE_ZONES,
    'source-layer': COUCHE_TUILE,
    minzoom: ZONES_RISQUE_ZOOM_DETAIL,
    layout: {
      visibility: visibilite,
      'symbol-placement': 'line',
      'text-field': expressionEtiquetteClasse(o.profil) as never,
      // Une police du style OpenFreeMap : une fonte absente ferait disparaître TOUT le calque, sans erreur.
      'text-font': ['Noto Sans Regular'],
      'text-size': 10,
      'symbol-spacing': 250,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': couleur as never,
      'text-halo-color': o.teintes.halo,
      'text-halo-width': 1.4,
    },
  });
}

/**
 * Bascule de thème : on REPEINT, on ne recrée ni la source ni les couches — aucune tuile n'est redemandée.
 * Une couche absente (pas encore posée) est ignorée : `setPaintProperty` lèverait.
 */
export function repeindreCouchesZones(carte: maplibregl.Map, t: TeintesZones): void {
  const couleur = expressionCouleurNiveau(t);
  const peindre = (id: string, propriete: string, valeur: unknown) => {
    if (carte.getLayer(id)) carte.setPaintProperty(id, propriete, valeur);
  };
  peindre(ID_FOND, 'fill-color', couleur);
  peindre(ID_CONTOUR, 'line-color', couleur);
  peindre(ID_PPRT, 'line-color', couleur);
  peindre(ID_ETIQUETTES, 'text-color', couleur);
  peindre(ID_ETIQUETTES, 'text-halo-color', t.halo);
}

/**
 * « Lecture des zones » : fusionnées (visibles) ou site par site (masquées). Ne fait que
 * `setLayoutProperty('visibility')` — aucune couche, aucune source, aucun appel. Une couche absente est
 * ignorée : `setLayoutProperty` lèverait, et l'exception laisserait les autres dans l'état précédent.
 */
export function basculerCouchesZones(carte: maplibregl.Map, visible: boolean): void {
  for (const id of COUCHES_ZONES) {
    if (carte.getLayer(id)) carte.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}
