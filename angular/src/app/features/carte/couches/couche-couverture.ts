import type maplibregl from 'maplibre-gl';
import type { Decoupage, LigneCouverture } from '../logique/analyses/couverture';
import { avantDe } from '../logique/ordre-couches';
import { IRIS_ZOOM_PLANCHER } from '../logique/versions';
import { SOURCE_IRIS } from './couche-iris';

/**
 * ④ Analyse — la couche « Couverture d'une zone » (lot 4, T8, arbitrage A-7), en fonctions PURES (patron
 * `couche-score.ts`) : sur LA carte principale, jamais une mini-carte.
 *
 * - le CONTOUR de la zone analysée, dans les trois découpages ;
 * - par code postal : les contours CP (`ContoursZonesService`) des SEULS codes de la réponse, aplat séquentiel de la
 *   `part` en cinq classes (`--seq-1…5`) ;
 * - par IRIS : une couche sur la source `iris-source` déjà employée par le calque IRIS (posée si absente, mêmes
 *   paramètres). ⚠ `get_iris_tile` (sql/139) sert des départements sous z7 et des communes à z7-z8 — chaque entité porte
 *   `niveau`, et le code IRIS s'appelle `code_iris` au seul palier `iris`. La couche prend donc `minzoom` 9 ET un filtre
 *   `niveau = 'iris'`, sans quoi le `match` s'appliquerait à des codes de commune (relecture R-9 du plan) ;
 * - une SURBRILLANCE (trait) du territoire survolé dans le tableau.
 *
 * Couleurs : valeurs CALCULÉES par `CouleursService` (jamais `var()` dans `paint`, jamais un hexadécimal recopié).
 */

export const SOURCE_COUVERTURE_ZONE = 'couverture-zone';
export const SOURCE_COUVERTURE_CP = 'couverture-cp';
export const COUCHE_COUVERTURE_CP_FOND = 'couverture-cp-fill';
export const COUCHE_COUVERTURE_CP_TRAIT = 'couverture-cp-line';
export const COUCHE_COUVERTURE_IRIS_FOND = 'couverture-iris-fill';
export const COUCHE_COUVERTURE_IRIS_TRAIT = 'couverture-iris-line';
export const COUCHE_COUVERTURE_CP_SURVOL = 'couverture-cp-survol';
export const COUCHE_COUVERTURE_IRIS_SURVOL = 'couverture-iris-survol';
export const COUCHE_COUVERTURE_ZONE = 'couverture-zone-line';

/** Toutes les couches, du dessous vers le dessus — l'ordre de `ORDRE_COUCHES`. */
export const COUCHES_COUVERTURE = [
  COUCHE_COUVERTURE_CP_FOND, COUCHE_COUVERTURE_CP_TRAIT, COUCHE_COUVERTURE_IRIS_FOND, COUCHE_COUVERTURE_IRIS_TRAIT,
  COUCHE_COUVERTURE_CP_SURVOL, COUCHE_COUVERTURE_IRIS_SURVOL, COUCHE_COUVERTURE_ZONE,
] as const;

/** Le premier zoom où les tuiles IRIS portent des IRIS (sql/139 : `z <= 8` → communes). */
export const ZOOM_IRIS_COUVERTURE = 9;
/** Les frontières des cinq classes de part (%) : < 20, 20-40, 40-60, 60-80, ≥ 80. */
export const BORNES_PART = [20, 40, 60, 80] as const;
const OPACITE_FOND = 0.6;

/** Les jetons lus par `CouleursService.palette` — cinq paliers séquentiels, l'absence, le contour, la surbrillance. */
export const JETONS_COUVERTURE = {
  s1: 'seq-1', s2: 'seq-2', s3: 'seq-3', s4: 'seq-4', s5: 'seq-5',
  absente: 'donnee-absente', zone: 'brand-teal', trait: 'text-tertiary', survol: 'text-primary',
} as const;
/**
 * Le trait des territoires TOUCHÉS (relecture T8, I2) : `--text-tertiary` (#8a8a8a, invariant) à 0,8 px. Le palier
 * `--seq-1` vaut #eaf7f5 en clair : sans un trait franc, un CP touché à 10 % se lisait « hors zone » (≈ 1:1 sur un
 * fond clair). #8a8a8a fait ≥ 3:1 sur le fond clair (objet graphique, WCAG 1.4.11) et reste lisible sur le sombre.
 */
const LARGEUR_TRAIT = 0.8;
export type PaletteCouverture = Record<keyof typeof JETONS_COUVERTURE, string>;

/** La classe (0-4) d'une part ; `null` sans dénominateur. Une borne appartient à la classe du HAUT. */
export function classePart(part: number | null): number | null {
  if (part === null || !Number.isFinite(part)) return null;
  let i = 0;
  while (i < BORNES_PART.length && part >= BORNES_PART[i]) i++;
  return i;
}

function paliers(p: PaletteCouverture): string[] {
  return [p.s1, p.s2, p.s3, p.s4, p.s5];
}

/** L'aplat d'un CP : `step` sur `part`, gris neutre sans dénominateur (« on ne sait pas » n'est pas « faible »). */
export function expressionCouleurCp(p: PaletteCouverture): unknown[] {
  const c = paliers(p);
  return [
    'case', ['==', ['get', 'part'], null], p.absente,
    ['step', ['get', 'part'], c[0], BORNES_PART[0], c[1], BORNES_PART[1], c[2], BORNES_PART[2], c[3], BORNES_PART[3], c[4]],
  ];
}

/**
 * L'aplat des IRIS : un `match` sur `code_iris` qui GROUPE les codes par classe (six entrées au plus, quelle que soit
 * la taille de la liste — 5 498 IRIS sur une région) ; un code hors réponse reste transparent.
 */
export function expressionCouleurIris(lignes: readonly LigneCouverture[], p: PaletteCouverture): unknown {
  const c = paliers(p);
  const groupes = new Map<number | null, string[]>();
  for (const l of lignes) {
    const k = classePart(l.part);
    const g = groupes.get(k);
    if (g) g.push(l.code);
    else groupes.set(k, [l.code]);
  }
  const branches: unknown[] = [];
  for (const [k, codes] of groupes) branches.push(codes, k === null ? p.absente : c[k]);
  return branches.length === 0 ? 'rgba(0,0,0,0)' : ['match', ['get', 'code_iris'], ...branches, 'rgba(0,0,0,0)'];
}

/** Les IRIS de la réponse, au seul palier `iris` des tuiles. */
export function filtreIrisCouverture(codes: readonly string[]): unknown[] {
  return ['all', ['==', ['get', 'niveau'], 'iris'], ['in', ['get', 'code_iris'], ['literal', [...codes]]]];
}

/** Le filtre de la surbrillance : le territoire survolé, ou aucun. */
export function filtreSurvol(propriete: 'code' | 'code_iris', code: string | null): unknown[] {
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

type CarteCouverture = Pick<
  maplibregl.Map, 'getSource' | 'addSource' | 'removeSource' | 'getLayer' | 'addLayer' | 'removeLayer' | 'setFilter' | 'getStyle'
>;

function ajouter(carte: CarteCouverture, couche: Record<string, unknown>): void {
  carte.addLayer(couche as maplibregl.LayerSpecification, avantDe(carte, couche['id'] as string));
}

/**
 * Pose la couverture : retire d'abord tout ce qui est à elle (un changement de découpage ou de thème repart propre),
 * puis chaque couche à son rang (`avantDe`). `urlIris` sert seulement si `iris-source` est absente.
 */
export function poserCoucheCouverture(carte: CarteCouverture, r: RenduCouverture, p: PaletteCouverture, urlIris: string): void {
  retirerCoucheCouverture(carte);
  if (r.decoupage === 'cp' && r.cp) {
    carte.addSource(SOURCE_COUVERTURE_CP, { type: 'geojson', data: r.cp });
    ajouter(carte, { id: COUCHE_COUVERTURE_CP_FOND, type: 'fill', source: SOURCE_COUVERTURE_CP, paint: { 'fill-color': expressionCouleurCp(p), 'fill-opacity': OPACITE_FOND } });
    ajouter(carte, { id: COUCHE_COUVERTURE_CP_TRAIT, type: 'line', source: SOURCE_COUVERTURE_CP, paint: { 'line-color': p.trait, 'line-width': LARGEUR_TRAIT } });
    ajouter(carte, {
      id: COUCHE_COUVERTURE_CP_SURVOL, type: 'line', source: SOURCE_COUVERTURE_CP, filter: filtreSurvol('code', null),
      paint: { 'line-color': p.survol, 'line-width': 2.5 },
    });
  }
  if (r.decoupage === 'iris' && r.iris && r.iris.length > 0) {
    if (!carte.getSource(SOURCE_IRIS)) {
      carte.addSource(SOURCE_IRIS, { type: 'vector', tiles: [urlIris], minzoom: IRIS_ZOOM_PLANCHER, maxzoom: 14, attribution: 'IGN — IRIS 2023' });
    }
    const commun = { source: SOURCE_IRIS, 'source-layer': 'iris', minzoom: ZOOM_IRIS_COUVERTURE };
    const filtre = filtreIrisCouverture(r.iris.map((l) => l.code));
    ajouter(carte, { id: COUCHE_COUVERTURE_IRIS_FOND, type: 'fill', ...commun, filter: filtre, paint: { 'fill-color': expressionCouleurIris(r.iris, p), 'fill-opacity': OPACITE_FOND } });
    ajouter(carte, { id: COUCHE_COUVERTURE_IRIS_TRAIT, type: 'line', ...commun, filter: filtre, paint: { 'line-color': p.trait, 'line-width': LARGEUR_TRAIT } });
    ajouter(carte, {
      id: COUCHE_COUVERTURE_IRIS_SURVOL, type: 'line', ...commun, filter: filtreSurvol('code_iris', null),
      paint: { 'line-color': p.survol, 'line-width': 2.5 },
    });
  }
  if (r.zone) {
    carte.addSource(SOURCE_COUVERTURE_ZONE, { type: 'geojson', data: r.zone });
    ajouter(carte, { id: COUCHE_COUVERTURE_ZONE, type: 'line', source: SOURCE_COUVERTURE_ZONE, paint: { 'line-color': p.zone, 'line-width': 2 } });
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
