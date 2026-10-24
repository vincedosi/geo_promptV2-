import { cercleGeoJSON } from '../../risques/logique/cercle';
import type { LigneSeuil } from '../logique/jeu/conversion';
import { estRetenue } from '../logique/jeu/conversion';
import type { ResultatCercles } from '../logique/jeu/bilan';
import { type CarteUnites, type PaletteUnites, ajouterCouche, poserUnitesGeojson, poserUnitesIris } from './couche-unites';

/**
 * ⑤ Jeu de zones — la carte de la plateforme REGARDÉE (lot 5, T11, A-14), en fonctions PURES : le contour de la zone
 * exacte, ses unités RETENUES teintées par part (`--seq-1…5`), les unités touchées NON retenues en contour fin
 * (`--contour-carte`). Aplats et traits par `couche-unites.ts`, la peinture partagée avec ④ : un seul code de peinture.
 * Le service (`jeu-carte.service.ts`) lit et calcule ; ces fonctions ne lisent rien.
 */

const SOURCE_JEU_UNITES = 'jeu-unites';
const SOURCE_JEU_ZONE = 'jeu-zone';
export const COUCHE_JEU_UNITES_FOND = 'jeu-unites-fill';
export const COUCHE_JEU_UNITES_TRAIT = 'jeu-unites-line';
export const COUCHE_JEU_IRIS_FOND = 'jeu-iris-fill';
export const COUCHE_JEU_IRIS_TRAIT = 'jeu-iris-line';
export const COUCHE_JEU_ZONE = 'jeu-zone-line';

/** Toutes les couches, du dessous vers le dessus — l'ordre de `ORDRE_COUCHES`. */
export const COUCHES_JEU = [COUCHE_JEU_UNITES_FOND, COUCHE_JEU_UNITES_TRAIT, COUCHE_JEU_IRIS_FOND, COUCHE_JEU_IRIS_TRAIT, COUCHE_JEU_ZONE] as const;

/** Le contour fin des unités touchées (retenues ou non) : il dit ce qu'on laisse, sans le teinter. */
const LARGEUR_CONTOUR_FIN = 0.5;

/** Les jetons lus par `CouleursService.palette` : cinq paliers séquentiels, l'absence, le contour fin, la zone. */
export const JETONS_JEU = {
  s1: 'seq-1', s2: 'seq-2', s3: 'seq-3', s4: 'seq-4', s5: 'seq-5', absente: 'donnee-absente', trait: 'contour-carte', zone: 'brand-teal',
} as const;
export type PaletteJeu = PaletteUnites & { zone: string };

/** Ce que la carte peint : tout est calculé avant (le service). */
export interface RenduJeu {
  /** Le contour de la zone exacte, s'il est lu. */
  zone: GeoJSON.Feature | null;
  /** Territoires (CP, département, commune) ou cercles, chacun avec `part` et `retenue`. */
  unites: GeoJSON.FeatureCollection | null;
  /** IRIS (tuiles) : les retenus à teinter, les touchés à cerner. */
  iris: { retenus: readonly { code: string; part: number | null }[]; touches: readonly string[] } | null;
}

/**
 * Les contours d'un découpage (`contours`, propriété `code`) restreints aux unités TOUCHÉES (`lignes`), chacune avec sa
 * part et `retenue` — la règle de rétention de l'extraction (`estRetenue`), au seuil de la plateforme. Une unité sans
 * contour (référentiel) n'est pas dessinée ; ses chiffres restent justes au panneau.
 */
export function entitesTerritoires(contours: GeoJSON.FeatureCollection, lignes: readonly (LigneSeuil & { code: string })[], seuil: number): GeoJSON.FeatureCollection {
  const parCode = new Map(lignes.map((l) => [l.code, l]));
  const features: GeoJSON.Feature[] = [];
  for (const f of contours.features) {
    const l = parCode.get(String(f.properties?.['code'] ?? ''));
    if (l) features.push({ type: 'Feature', geometry: f.geometry, properties: { code: l.code, part: l.part, retenue: estRetenue(l, seuil) } });
  }
  return { type: 'FeatureCollection', features };
}

/** Les cercles d'un pavage (tous RETENUS : `paver_cercles` ne rend que ceux-là), en UNE collection. */
export function entitesCercles(pavage: Pick<ResultatCercles, 'cercles' | 'rayon_m'>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pavage.cercles.map((c) => ({ ...cercleGeoJSON(c.lon, c.lat, pavage.rayon_m), properties: { part: c.part, retenue: true } })),
  };
}

/** Pose la carte de ⑤ : retire d'abord tout ce qui est à elle, puis chaque couche à son rang. */
export function poserCoucheJeu(carte: CarteUnites, r: RenduJeu, p: PaletteJeu, urlIris: string): void {
  retirerCoucheJeu(carte);
  if (r.unites) {
    poserUnitesGeojson(carte, { source: SOURCE_JEU_UNITES, fond: COUCHE_JEU_UNITES_FOND, trait: COUCHE_JEU_UNITES_TRAIT }, r.unites, p, {
      filtreFond: ['==', ['get', 'retenue'], true], traitLargeur: LARGEUR_CONTOUR_FIN,
    });
  }
  if (r.iris && r.iris.touches.length > 0) {
    poserUnitesIris(carte, { fond: COUCHE_JEU_IRIS_FOND, trait: COUCHE_JEU_IRIS_TRAIT }, r.iris.retenus, p, urlIris, {
      contours: r.iris.touches, traitLargeur: LARGEUR_CONTOUR_FIN,
    });
  }
  if (r.zone) {
    carte.addSource(SOURCE_JEU_ZONE, { type: 'geojson', data: r.zone });
    ajouterCouche(carte, { id: COUCHE_JEU_ZONE, type: 'line', source: SOURCE_JEU_ZONE, paint: { 'line-color': p.zone, 'line-width': 2 } });
  }
}

/** Couches PUIS sources. `iris-source` appartient au calque IRIS : gardée. */
export function retirerCoucheJeu(carte: CarteUnites): void {
  for (const id of [...COUCHES_JEU].reverse()) if (carte.getLayer(id)) carte.removeLayer(id);
  for (const s of [SOURCE_JEU_UNITES, SOURCE_JEU_ZONE]) if (carte.getSource(s)) carte.removeSource(s);
}
