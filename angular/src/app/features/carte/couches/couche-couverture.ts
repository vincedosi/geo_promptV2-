import type maplibregl from 'maplibre-gl';
import type { Decoupage, LigneCouverture } from '../logique/analyses/couverture';
import { SOURCE_IRIS } from './couche-iris';
import {
  BORNES_PART, type CarteUnites, ZOOM_IRIS_UNITES, ajouterCouche, classePart, expressionCouleurIris, poserUnitesGeojson, poserUnitesIris,
} from './couche-unites';

/**
 * ④ Analyse — la couche « Couverture d'une zone » (lot 4, T8, arbitrage A-7), en fonctions PURES (patron
 * `couche-score.ts`) : sur LA carte principale, jamais une mini-carte.
 *
 * - le CONTOUR de la zone analysée, dans les trois découpages ;
 * - par code postal : les contours CP (`ContoursZonesService`) des SEULS codes de la réponse, aplat séquentiel de la
 *   `part` en cinq classes (`--seq-1…5`) ;
 * - par IRIS : une couche sur la source `iris-source` déjà employée par le calque IRIS (`minzoom` 9, `niveau = 'iris'`) ;
 *
 * Aplats et traits par part : `couche-unites.ts`, la peinture PARTAGÉE avec ⑤ Jeu de zones (lot 5, T11) — un seul
 * code de peinture ; ce fichier garde ses identifiants, le contour de la zone et la surbrillance.
 * - une SURBRILLANCE (trait) du territoire survolé dans le tableau.
 *
 * Couleurs : valeurs CALCULÉES par `CouleursService` (jamais `var()` dans `paint`, jamais un hexadécimal recopié).
 */

const SOURCE_COUVERTURE_ZONE = 'couverture-zone';
export const SOURCE_COUVERTURE_CP = 'couverture-cp';
export const COUCHE_COUVERTURE_CP_FOND = 'couverture-cp-fill';
const COUCHE_COUVERTURE_CP_TRAIT = 'couverture-cp-line';
export const COUCHE_COUVERTURE_IRIS_FOND = 'couverture-iris-fill';
const COUCHE_COUVERTURE_IRIS_TRAIT = 'couverture-iris-line';
export const COUCHE_COUVERTURE_CP_SURVOL = 'couverture-cp-survol';
export const COUCHE_COUVERTURE_IRIS_SURVOL = 'couverture-iris-survol';
export const COUCHE_COUVERTURE_ZONE = 'couverture-zone-line';

/** Toutes les couches, du dessous vers le dessus — l'ordre de `ORDRE_COUCHES`. */
export const COUCHES_COUVERTURE = [
  COUCHE_COUVERTURE_CP_FOND, COUCHE_COUVERTURE_CP_TRAIT, COUCHE_COUVERTURE_IRIS_FOND, COUCHE_COUVERTURE_IRIS_TRAIT,
  COUCHE_COUVERTURE_CP_SURVOL, COUCHE_COUVERTURE_IRIS_SURVOL, COUCHE_COUVERTURE_ZONE,
] as const;

/** Le premier zoom où les tuiles IRIS portent des IRIS — celui de la peinture partagée. */
export const ZOOM_IRIS_COUVERTURE = ZOOM_IRIS_UNITES;
export { BORNES_PART, classePart, expressionCouleurIris };

/** Les jetons lus par `CouleursService.palette` — cinq paliers séquentiels, l'absence, le contour, la surbrillance. */
export const JETONS_COUVERTURE = {
  s1: 'seq-1', s2: 'seq-2', s3: 'seq-3', s4: 'seq-4', s5: 'seq-5',
  absente: 'donnee-absente', zone: 'brand-teal', trait: 'text-tertiary', survol: 'text-primary',
} as const;
/**
 * `trait` : le trait des territoires TOUCHÉS (relecture T8, I2), `--text-tertiary` (#8a8a8a, invariant) à 0,8 px. Le
 * palier `--seq-1` vaut #eaf7f5 en clair : sans un trait franc, un CP touché à 10 % se lisait « hors zone ». #8a8a8a
 * fait ≈ 3,0:1 sur le fond de carte réel (terre OSM #f2efe9) : le seuil WCAG 1.4.11 des objets graphiques.
 */
export type PaletteCouverture = Record<keyof typeof JETONS_COUVERTURE, string>;

/** Le filtre de la surbrillance : le territoire survolé, ou aucun. */
function filtreSurvol(propriete: 'code' | 'code_iris', code: string | null): unknown[] {
  const f = ['==', ['get', propriete], code ?? ''];
  return propriete === 'code_iris' ? ['all', ['==', ['get', 'niveau'], 'iris'], f] : f;
}

/** Les contours CP des SEULS codes de la réponse, avec `part`, `pop_en_zone` et `nom` en propriétés. */
export function entitesCouvertureCp(contours: GeoJSON.FeatureCollection, lignes: readonly LigneCouverture[]): GeoJSON.FeatureCollection {
  const parCode = new Map(lignes.map((l) => [l.code, l]));
  const features: GeoJSON.Feature[] = [];
  for (const f of contours.features) {
    const l = parCode.get(String(f.properties?.['code'] ?? ''));
    if (l) features.push({ ...f, properties: { code: l.code, nom: l.nom, part: l.part, pop_en_zone: l.pop_en_zone } });
  }
  return { type: 'FeatureCollection', features };
}

/** Ce que la carte peint : tout est calculé avant (le service), ces fonctions ne lisent rien. */
export interface RenduCouverture {
  /** Le contour de la zone, s'il est déjà lu. */
  zone: GeoJSON.Feature | null;
  decoupage: Decoupage;
  /** Découpage `cp` : les contours filtrés (`null` tant qu'ils ne sont pas lus). */
  cp: GeoJSON.FeatureCollection | null;
  /** Découpage `iris` : les lignes de la réponse. */
  iris: readonly LigneCouverture[] | null;
}

type CarteCouverture = CarteUnites;

/**
 * Pose la couverture : retire d'abord tout ce qui est à elle (un changement de découpage ou de thème repart propre),
 * puis chaque couche à son rang (`avantDe`). `urlIris` sert seulement si `iris-source` est absente.
 */
export function poserCoucheCouverture(carte: CarteCouverture, r: RenduCouverture, p: PaletteCouverture, urlIris: string): void {
  retirerCoucheCouverture(carte);
  if (r.decoupage === 'cp' && r.cp) {
    poserUnitesGeojson(carte, { source: SOURCE_COUVERTURE_CP, fond: COUCHE_COUVERTURE_CP_FOND, trait: COUCHE_COUVERTURE_CP_TRAIT }, r.cp, p);
    ajouterCouche(carte, {
      id: COUCHE_COUVERTURE_CP_SURVOL, type: 'line', source: SOURCE_COUVERTURE_CP, filter: filtreSurvol('code', null),
      paint: { 'line-color': p.survol, 'line-width': 2.5 },
    });
  }
  if (r.decoupage === 'iris' && r.iris && r.iris.length > 0) {
    poserUnitesIris(carte, { fond: COUCHE_COUVERTURE_IRIS_FOND, trait: COUCHE_COUVERTURE_IRIS_TRAIT }, r.iris, p, urlIris);
    ajouterCouche(carte, {
      id: COUCHE_COUVERTURE_IRIS_SURVOL, type: 'line', source: SOURCE_IRIS, 'source-layer': 'iris', minzoom: ZOOM_IRIS_UNITES,
      filter: filtreSurvol('code_iris', null), paint: { 'line-color': p.survol, 'line-width': 2.5 },
    });
  }
  if (r.zone) {
    carte.addSource(SOURCE_COUVERTURE_ZONE, { type: 'geojson', data: r.zone });
    ajouterCouche(carte, { id: COUCHE_COUVERTURE_ZONE, type: 'line', source: SOURCE_COUVERTURE_ZONE, paint: { 'line-color': p.zone, 'line-width': 2 } });
  }
}

/** La surbrillance du territoire survolé (ou aucune), sur la couche du découpage posé. */
export function surlignerCouverture(carte: CarteCouverture, code: string | null): void {
  if (carte.getLayer(COUCHE_COUVERTURE_CP_SURVOL)) carte.setFilter(COUCHE_COUVERTURE_CP_SURVOL, filtreSurvol('code', code) as maplibregl.FilterSpecification);
  if (carte.getLayer(COUCHE_COUVERTURE_IRIS_SURVOL)) {
    carte.setFilter(COUCHE_COUVERTURE_IRIS_SURVOL, filtreSurvol('code_iris', code) as maplibregl.FilterSpecification);
  }
}

/** Couches PUIS sources (MapLibre lève si une couche emploie encore la source). `iris-source` n'est pas à nous : gardée. */
export function retirerCoucheCouverture(carte: CarteCouverture): void {
  for (const id of [...COUCHES_COUVERTURE].reverse()) if (carte.getLayer(id)) carte.removeLayer(id);
  for (const s of [SOURCE_COUVERTURE_CP, SOURCE_COUVERTURE_ZONE]) if (carte.getSource(s)) carte.removeSource(s);
}
