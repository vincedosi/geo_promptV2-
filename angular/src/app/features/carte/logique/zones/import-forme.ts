/**
 * Lire une forme importée (GeoJSON ou KML) en un MultiPolygon (spec carte-en-parcours § 16.3, « import de polygone »).
 * Pur : `DOMParser` pour le KML (pas d'écouteur, pas de document global modifié — contrainte AIDA).
 * On garde les polygones, on COMPTE ce qu'on ignore (points, lignes), on refuse au-delà de 20 000 sommets et on
 * signale des coordonnées hors bornes (lat/lon inversées) au lieu de les corriger. La réparation géométrique
 * (auto-intersection) et le découpage sur la France sont faits par le serveur (`zone_dessin`, sql/156).
 */
import { formaterNombre } from '../../../../core/format/nombre';
import { MAX_SOMMETS_FORME } from './recette';

type Anneau = number[][];
type Poly = Anneau[];
export type FormeLue =
  | { ok: true; format: 'geojson' | 'kml'; geometrie: GeoJSON.MultiPolygon; polygones: number; ignores: number; sommets: number }
  | { ok: false; message: string };

const ILLISIBLE = 'Fichier illisible : ni GeoJSON ni KML.';

function terminer(format: 'geojson' | 'kml', polys: Poly[], ignores: number): FormeLue {
  if (polys.length === 0) return { ok: false, message: 'Aucun polygone dans ce fichier.' };
  const sommets = polys.reduce((n, p) => n + p.reduce((m, a) => m + a.length, 0), 0);
  if (sommets > MAX_SOMMETS_FORME) {
    return { ok: false, message: `La forme compte ${formaterNombre(sommets)} sommets, au-delà de ${formaterNombre(MAX_SOMMETS_FORME)} : simplifiez-la avant de l’importer.` };
  }
  const horsBornes = polys.some((p) => p.some((a) => a.some(([x, y]) => !(Math.abs(x) <= 180 && Math.abs(y) <= 90))));
  // La métropole INVERSÉE : « longitude » entre 41 et 51,5 et « latitude » entre −5,5 et 10. Mayotte (lon 45,
  // lat −12,8) n'y tombe pas : la règle ne refuse jamais un DROM.
  const inverse = !horsBornes && polys.every((p) => p.every((a) => a.every(([x, y]) => x >= 41 && x <= 51.5 && y >= -5.5 && y <= 10)));
  if (horsBornes || inverse) {
    return { ok: false, message: 'Coordonnées hors des bornes longitude/latitude : le fichier inverse-t-il latitude et longitude ?' };
  }
  return { ok: true, format, geometrie: { type: 'MultiPolygon', coordinates: polys }, polygones: polys.length, ignores, sommets };
}

function depuisGeoJson(v: unknown): FormeLue {
  const polys: Poly[] = [];
  let ignores = 0;
  const geometrie = (g: unknown): void => {
    const o = g as { type?: string; coordinates?: unknown; geometries?: unknown[] } | null;
    if (o?.type === 'Polygon' && Array.isArray(o.coordinates)) polys.push(o.coordinates as Poly);
    else if (o?.type === 'MultiPolygon' && Array.isArray(o.coordinates)) polys.push(...(o.coordinates as Poly[]));
    else if (o?.type === 'GeometryCollection' && Array.isArray(o.geometries)) o.geometries.forEach(geometrie);
    else ignores += 1;
  };
  const o = v as { type?: string; features?: unknown[]; geometry?: unknown } | null;
  if (o?.type === 'FeatureCollection' && Array.isArray(o.features)) o.features.forEach((f) => geometrie((f as { geometry?: unknown } | null)?.geometry));
  else if (o?.type === 'Feature') geometrie(o.geometry);
  else geometrie(o);
  return terminer('geojson', polys, ignores);
}

/** Par nom LOCAL, quel que soit le préfixe : un KML écrit `<kml:Polygon>` se lit comme `<Polygon>`. */
function balises(n: Element | Document, nom: string): Element[] {
  return Array.from(n.getElementsByTagNameNS('*', nom));
}

function anneauKml(el: Element | null): Anneau | null {
  const txt = el ? balises(el, 'coordinates')[0]?.textContent?.trim() : undefined;
  if (!txt) return null;
  return txt.split(/\s+/).map((t) => t.split(',').slice(0, 2).map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
}

function depuisKml(texte: string): FormeLue {
  const doc = new DOMParser().parseFromString(texte, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, message: ILLISIBLE };
  const polys: Poly[] = [];
  for (const p of balises(doc, 'Polygon')) {
    const ext = anneauKml(balises(p, 'outerBoundaryIs')[0] ?? null);
    if (!ext) continue;
    const trous = balises(p, 'innerBoundaryIs').map((i) => anneauKml(i)).filter((a): a is Anneau => !!a);
    polys.push([ext, ...trous]);
  }
  const ignores = ['Point', 'LineString'].reduce((n, t) => n + balises(doc, t).length, 0);
  return terminer('kml', polys, ignores);
}

export function lireForme(texte: string, nomFichier: string): FormeLue {
  const t = texte.replace(/^﻿/, '').trim();
  if (t.length === 0) return { ok: false, message: 'Fichier vide.' };
  if (t.startsWith('<') || /\.kml$/i.test(nomFichier)) return depuisKml(t);
  try {
    return depuisGeoJson(JSON.parse(t));
  } catch {
    return { ok: false, message: ILLISIBLE };
  }
}
