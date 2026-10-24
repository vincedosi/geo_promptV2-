import type maplibregl from 'maplibre-gl';
import { avantDe } from '../logique/ordre-couches';
import { IRIS_ZOOM_PLANCHER } from '../logique/versions';
import { SOURCE_IRIS } from './couche-iris';

/**
 * La peinture d'UNITÉS PAR PART — un territoire (CP, département, commune, IRIS) ou un cercle, teinté par la part de
 * sa population qui vit dans la zone, en cinq classes séquentielles (`--seq-1…5`). UN SEUL code de peinture pour ④
 * (`couche-couverture.ts`, lot 4) et ⑤ (`couche-jeu.ts`, lot 5, T11, A-14) : chacun passe ses identifiants de source
 * et de couches, et ce qu'il peint. Fonctions PURES : elles ne lisent rien, les couleurs arrivent CALCULÉES
 * (`CouleursService`, jamais `var()` dans `paint`).
 *
 * IRIS : la source `iris-source` du calque IRIS (posée si absente, mêmes paramètres). ⚠ `get_iris_tile` (sql/139) sert
 * des départements sous z7 et des communes à z7-z8 — chaque entité porte `niveau`, et le code IRIS s'appelle
 * `code_iris` au seul palier `iris` : `minzoom` 9 ET un filtre `niveau = 'iris'`, sinon le `match` s'appliquerait à
 * des codes de commune (relecture R-9 du plan du lot 4).
 */

/** Le premier zoom où les tuiles IRIS portent des IRIS (sql/139 : `z <= 8` → communes). */
export const ZOOM_IRIS_UNITES = 9;
/** Les frontières des cinq classes de part (%) : < 20, 20-40, 40-60, 60-80, ≥ 80. */
export const BORNES_PART = [20, 40, 60, 80] as const;
const OPACITE_FOND = 0.6;
/**
 * Le trait des unités peintes : 0,8 px (relecture T8 du lot 4, I2) — un palier `--seq-1` clair sans trait franc se
 * lisait « hors zone ».
 */
export const LARGEUR_TRAIT_UNITES = 0.8;

/** Ce que la peinture lit de la palette : cinq paliers, l'absence de dénominateur, le trait. */
export interface PaletteUnites {
  s1: string; s2: string; s3: string; s4: string; s5: string;
  absente: string;
  trait: string;
}

/** Les identifiants d'une peinture : sa source (GeoJSON ; IRIS : la source partagée) et ses deux couches. */
export interface IdsUnites {
  source: string;
  fond: string;
  trait: string;
}

/** Ce qu'on peut changer au trait et à l'aplat : les unités NON retenues de ⑤ ne prennent qu'un contour fin. */
export interface OptionsUnites {
  /** Filtre de l'aplat seul (le trait couvre toutes les unités). */
  filtreFond?: unknown;
  traitCouleur?: string;
  traitLargeur?: number;
}

export type CarteUnites = Pick<
  maplibregl.Map, 'getSource' | 'addSource' | 'removeSource' | 'getLayer' | 'addLayer' | 'removeLayer' | 'setFilter' | 'getStyle'
>;

/** La classe (0-4) d'une part ; `null` sans dénominateur. Une borne appartient à la classe du HAUT. */
export function classePart(part: number | null): number | null {
  if (part === null || !Number.isFinite(part)) return null;
  let i = 0;
  while (i < BORNES_PART.length && part >= BORNES_PART[i]) i++;
  return i;
}

/** Les libellés des cinq classes, pour une légende (« < 20 % », « 20-40 % »… « ≥ 80 % ») — ④ et ⑤ la partagent. */
export function libellesPaliers(): string[] {
  return [0, 1, 2, 3, 4].map((i) => (i === 0 ? `< ${BORNES_PART[0]} %` : i === BORNES_PART.length ? `≥ ${BORNES_PART[i - 1]} %` : `${BORNES_PART[i - 1]}-${BORNES_PART[i]} %`));
}

function paliers(p: PaletteUnites): string[] {
  return [p.s1, p.s2, p.s3, p.s4, p.s5];
}

/** Pose une couche à son rang (`avantDe`, ordre de `logique/ordre-couches.ts`). */
export function ajouterCouche(carte: CarteUnites, couche: Record<string, unknown>): void {
  carte.addLayer(couche as maplibregl.LayerSpecification, avantDe(carte, couche['id'] as string));
}

/** L'aplat d'une entité GeoJSON : `step` sur `part`, gris neutre sans dénominateur (« on ne sait pas » n'est pas « faible »). */
export function expressionCouleurPart(p: PaletteUnites): unknown[] {
  const c = paliers(p);
  return [
    'case', ['==', ['get', 'part'], null], p.absente,
    ['step', ['get', 'part'], c[0], BORNES_PART[0], c[1], BORNES_PART[1], c[2], BORNES_PART[2], c[3], BORNES_PART[3], c[4]],
  ];
}

/**
 * L'aplat des IRIS : un `match` sur `code_iris` qui GROUPE les codes par classe (six entrées au plus, quelle que soit
 * la taille de la liste — 5 498 IRIS sur une région) ; un code hors liste reste transparent.
 */
export function expressionCouleurIris(lignes: readonly { code: string; part: number | null }[], p: PaletteUnites): unknown {
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

/** Les IRIS d'une liste, au seul palier `iris` des tuiles. */
export function filtreIris(codes: readonly string[]): unknown[] {
  return ['all', ['==', ['get', 'niveau'], 'iris'], ['in', ['get', 'code_iris'], ['literal', [...codes]]]];
}

/** Des entités GeoJSON (territoires, cercles) portant `part` : un aplat par part, un trait. */
export function poserUnitesGeojson(carte: CarteUnites, ids: IdsUnites, data: GeoJSON.FeatureCollection, p: PaletteUnites, o: OptionsUnites = {}): void {
  carte.addSource(ids.source, { type: 'geojson', data });
  ajouterCouche(carte, {
    id: ids.fond, type: 'fill', source: ids.source, ...(o.filtreFond ? { filter: o.filtreFond } : {}),
    paint: { 'fill-color': expressionCouleurPart(p), 'fill-opacity': OPACITE_FOND },
  });
  ajouterCouche(carte, {
    id: ids.trait, type: 'line', source: ids.source,
    paint: { 'line-color': o.traitCouleur ?? p.trait, 'line-width': o.traitLargeur ?? LARGEUR_TRAIT_UNITES },
  });
}

/**
 * Des IRIS des tuiles : l'aplat des `lignes` (par part), le trait de `contours` (par défaut les mêmes). `iris-source`
 * est posée si absente (`urlIris`) et jamais retirée ici : elle appartient au calque IRIS.
 */
export function poserUnitesIris(
  carte: CarteUnites, ids: Omit<IdsUnites, 'source'>, lignes: readonly { code: string; part: number | null }[], p: PaletteUnites, urlIris: string,
  o: OptionsUnites & { contours?: readonly string[] } = {},
): void {
  if (!carte.getSource(SOURCE_IRIS)) {
    carte.addSource(SOURCE_IRIS, { type: 'vector', tiles: [urlIris], minzoom: IRIS_ZOOM_PLANCHER, maxzoom: 14, attribution: 'IGN — IRIS 2023' });
  }
  const commun = { source: SOURCE_IRIS, 'source-layer': 'iris', minzoom: ZOOM_IRIS_UNITES };
  const filtre = filtreIris(lignes.map((l) => l.code));
  ajouterCouche(carte, { id: ids.fond, type: 'fill', ...commun, filter: filtre, paint: { 'fill-color': expressionCouleurIris(lignes, p), 'fill-opacity': OPACITE_FOND } });
  ajouterCouche(carte, {
    id: ids.trait, type: 'line', ...commun, filter: o.contours ? filtreIris(o.contours) : filtre,
    paint: { 'line-color': o.traitCouleur ?? p.trait, 'line-width': o.traitLargeur ?? LARGEUR_TRAIT_UNITES },
  });
}
