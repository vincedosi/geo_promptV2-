import type maplibregl from 'maplibre-gl';
import type { ApercuRayon } from '../commandes/reglette-rayons.component';
import { cercleGeoJSON } from '../logique/cercle';
import { LARGEUR_TRAIT_ZONE, TIRETE_ZONE_CALCULEE } from '../logique/nature-zone';
import { type Niveau, type ProfilRayons, anneauxDuNiveau } from '../logique/profil';

/**
 * Les SITES de la carte du module risque, et les trois dessins qui en dérivent — portage de
 * `CarteRisque.tsx:562-955` : les points (GeoJSON de la bbox visible), le SURVOL (les anneaux d'un site),
 * l'APERÇU pendant le glissement d'une réglette, et les cercles du mode SITE PAR SITE.
 *
 * ⚠ Les trois dessins sont calculés CÔTÉ CLIENT depuis les sites DÉJÀ chargés et le profil : aucun ne fait de
 * requête. Un survol qui appellerait le serveur émettrait des dizaines de requêtes par mouvement de souris sur une
 * grappe dense ; l'aperçu, une par position du curseur.
 *
 * ⚠ **Jamais `var()` dans `paint`** (`addLayer` LÈVE et la couche n'existe pas, tandis que le compte « N sites
 * affichés » resterait juste — un compte exact pour des points absents). Les teintes arrivent résolues par
 * `CouleursService`.
 *
 * Toutes les couches sont en `line` et jamais en `fill`, mesure de React (2026-09-21) : des disques qui se
 * recouvrent empilent leur alpha, et une grappe dense vire à l'aplat plein — on lirait une intensité là où il n'y
 * a qu'une densité de sites, l'inverse de ce que disent les vraies zones (exclusives, opacité = distance).
 */

export const SOURCE_SITES = 'atelier-sites';
export const ID_SITES = 'atelier-sites-points';
export const SOURCE_SURVOL = 'atelier-survol';
export const ID_SURVOL = 'atelier-survol-cercles';
export const SOURCE_APERCU = 'atelier-apercu';
export const ID_APERCU = 'atelier-apercu-cercles';
export const SOURCE_CERCLES = 'atelier-cercles';
export const ID_CERCLES = 'atelier-cercles-traits';

/**
 * Le nombre de CERCLES dessinés en mode site par site (`CERCLES_MAX`). Le plafond porte sur les cercles et non
 * sur les sites : un site du seuil haut porte jusqu'à quatre anneaux, donc 250 sites autoriseraient 1 000
 * cercles. 400 × 64 segments = 25 600 points.
 */
export const CERCLES_MAX = 400;

/**
 * Le nombre de SITES dont on dessine l'aperçu pendant un glissement (`APERCU_SITES_MAX`) : 64 segments par
 * cercle, reconstruits à chaque position du curseur — à 800 sites, 51 200 points par image.
 */
export const APERCU_SITES_MAX = 250;

/** Les teintes résolues : une par niveau, et le cerne des points — INVERSÉ entre thèmes (`--contour-point`). */
export interface TeintesSites {
  haut: string;
  bas: string;
  autres: string;
  contourPoint: string;
}

const VIDE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** `seveso_haut` → haut, `seveso_bas` → bas, tout le reste → autres (`CarteRisque.tsx:377`). */
export function niveauDeGravite(gravite: unknown): Niveau {
  return gravite === 'seveso_haut' ? 'haut' : gravite === 'seveso_bas' ? 'bas' : 'autres';
}

function pointDe(f: GeoJSON.Feature): { lon: number; lat: number; niveau: Niveau } | null {
  const g = f.geometry;
  if (!g || g.type !== 'Point') return null;
  const [lon, lat] = g.coordinates as [number, number];
  return { lon, lat, niveau: niveauDeGravite(f.properties?.['gravite']) };
}

/**
 * Les cercles du mode site par site : chaque anneau du niveau de chaque site, avec sa propriété `niveau` (deux
 * sites de seuils différents peuvent avoir des cercles imbriqués). `anneauxDuNiveau` et jamais `profil[niveau]` :
 * cadenas fermé, les anneaux du seuil haut valent pour tous. Un niveau sans anneau garde son point sans cercle.
 */
export function cerclesDesSites(
  fc: GeoJSON.FeatureCollection | null, profil: ProfilRayons, max: number = CERCLES_MAX,
): GeoJSON.Feature[] {
  const sortie: GeoJSON.Feature[] = [];
  for (const f of fc?.features ?? []) {
    if (sortie.length >= max) break;
    const p = pointDe(f);
    if (!p) continue;
    for (const rayon of anneauxDuNiveau(profil, p.niveau)) {
      if (sortie.length >= max) break;
      const cercle = cercleGeoJSON(p.lon, p.lat, rayon);
      sortie.push({ ...cercle, properties: { ...(cercle.properties ?? {}), niveau: p.niveau } });
    }
  }
  return sortie;
}

/**
 * Les cercles d'aperçu : UN par site, au rayon en cours de réglage. APPROXIMATIFS — des disques et non les zones
 * exclusives de sql/205 ; l'aperçu répond à « jusqu'où ça va », pas à « qui appartient à quoi ». `niveau: null`
 * (niveaux liés) : tous les sites ; sinon seul le niveau réglé bouge.
 */
export function cerclesApercu(
  fc: GeoJSON.FeatureCollection | null, apercu: ApercuRayon, max: number = APERCU_SITES_MAX,
): GeoJSON.Feature[] {
  const sortie: GeoJSON.Feature[] = [];
  for (const f of fc?.features ?? []) {
    if (sortie.length >= max) break;
    const p = pointDe(f);
    if (!p) continue;
    if (apercu.niveau !== null && apercu.niveau !== p.niveau) continue;
    sortie.push(cercleGeoJSON(p.lon, p.lat, apercu.rayonM));
  }
  return sortie;
}

/** Les anneaux du site survolé, au profil COURANT : ce que CE site engendre (l'aplat exclusif ne le dit pas). */
export function cerclesSurvol(f: GeoJSON.Feature, profil: ProfilRayons): GeoJSON.Feature[] {
  const p = pointDe(f);
  if (!p) return [];
  return anneauxDuNiveau(profil, p.niveau).map((r) => cercleGeoJSON(p.lon, p.lat, r));
}

function couleurGravite(t: TeintesSites): unknown[] {
  return ['match', ['get', 'gravite'], 'seveso_haut', t.haut, 'seveso_bas', t.bas, t.autres];
}

function couleurNiveau(t: TeintesSites): unknown[] {
  return ['match', ['get', 'niveau'], 'haut', t.haut, 'bas', t.bas, t.autres];
}

/**
 * Pose les quatre sources (vides) et leurs couches, du dessous au dessus : cercles du site par site, aperçu,
 * survol, points — l'ordre de React (`CarteRisque.tsx:888-948`, puis les points à leur premier chargement) : les
 * gestes en cours restent lisibles par-dessus les cercles, et les points restent cliquables par-dessus tout.
 * À appeler UNE fois, au chargement de la carte ; les données passent ensuite par `setData`.
 */
export function poserCouchesSites(carte: maplibregl.Map, t: TeintesSites, cerclesVisibles: boolean): void {
  carte.addSource(SOURCE_CERCLES, { type: 'geojson', data: VIDE });
  carte.addLayer({
    id: ID_CERCLES,
    type: 'line',
    source: SOURCE_CERCLES,
    layout: { visibility: cerclesVisibles ? 'visible' : 'none' },
    paint: {
      'line-color': couleurNiveau(t) as never,
      'line-width': LARGEUR_TRAIT_ZONE,
      // Tireté : des rayons QUE NOUS CALCULONS, même convention que le contour des bandes.
      'line-dasharray': [...TIRETE_ZONE_CALCULEE] as never,
      'line-opacity': 0.75,
    },
  });

  carte.addSource(SOURCE_APERCU, { type: 'geojson', data: VIDE });
  carte.addLayer({
    id: ID_APERCU,
    type: 'line',
    source: SOURCE_APERCU,
    // La teinte du seuil haut, quel que soit le niveau réglé (React) : un trait, jamais un aplat.
    paint: { 'line-color': t.haut, 'line-width': 1.5, 'line-opacity': 0.9 },
  });

  carte.addSource(SOURCE_SURVOL, { type: 'geojson', data: VIDE });
  carte.addLayer({
    id: ID_SURVOL,
    type: 'line',
    source: SOURCE_SURVOL,
    // Le cerne des points plutôt que la teinte du niveau : ces cercles se superposent aux zones de CETTE teinte.
    paint: { 'line-color': t.contourPoint, 'line-width': 1, 'line-opacity': 0.85 },
  });

  carte.addSource(SOURCE_SITES, { type: 'geojson', data: VIDE });
  carte.addLayer({
    id: ID_SITES,
    type: 'circle',
    source: SOURCE_SITES,
    paint: {
      // À z8 le point ne doit pas masquer la zone qu'il engendre, à z13 il doit rester cliquable.
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 13, 5.5],
      'circle-color': couleurGravite(t) as never,
      'circle-stroke-color': t.contourPoint,
      'circle-stroke-width': 1,
    },
  });
}

/**
 * Bascule de thème : on REPEINT les cinq propriétés colorées, sans recréer ni source ni couche. React, lui, ne
 * repeignait PAS ces couches (sa pose était gardée par `if (getSource(...)) return`, et les points ne faisaient
 * que `setData`) : après une bascule, points, cercles, aperçu et survol gardaient les couleurs de l'autre thème.
 */
export function repeindreCouchesSites(carte: maplibregl.Map, t: TeintesSites): void {
  const peindre = (id: string, propriete: string, valeur: unknown) => {
    if (carte.getLayer(id)) carte.setPaintProperty(id, propriete, valeur);
  };
  peindre(ID_SITES, 'circle-color', couleurGravite(t));
  peindre(ID_SITES, 'circle-stroke-color', t.contourPoint);
  peindre(ID_CERCLES, 'line-color', couleurNiveau(t));
  peindre(ID_APERCU, 'line-color', t.haut);
  peindre(ID_SURVOL, 'line-color', t.contourPoint);
}

/** « Lecture des zones » : les cercles du site par site sont visibles quand les zones ne sont PAS fusionnées. */
export function basculerCerclesSites(carte: maplibregl.Map, visibles: boolean): void {
  if (carte.getLayer(ID_CERCLES)) carte.setLayoutProperty(ID_CERCLES, 'visibility', visibles ? 'visible' : 'none');
}

/** Remplace les données d'une des quatre sources (sans effet si elle n'existe pas encore). */
export function ecrireSource(carte: maplibregl.Map, source: string, features: GeoJSON.Feature[] | GeoJSON.FeatureCollection): void {
  const donnees = Array.isArray(features) ? { type: 'FeatureCollection' as const, features } : features;
  (carte.getSource(source) as maplibregl.GeoJSONSource | undefined)?.setData(donnees);
}
