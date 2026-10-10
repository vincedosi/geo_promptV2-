/**
 * Logique PURE de la capture des couches — portage de `components/custom-geo/CustomGeoCaptureModal.tsx` (lot 4, T16).
 *
 * La capture enregistre la vue comme une zone : les géométries de chaque couche contributive allumée (carreaux, IRIS
 * sélectionné, couverture radio, bataille…) partent ensemble à `/api/custom-geo/capture`, qui les fusionne selon la
 * transformation choisie. Une bataille à plusieurs POI garde en plus la liste de ses POI et une sous-zone par POI :
 * le Custom Bidding pourra pondérer chaque POI séparément, sur une zone qui reste UNE ligne en base.
 */
import { bboxDeGeometrie } from './zones-affichees';

export type TransformationCapture = 'union' | 'convex_hull' | 'envelope' | 'raw';

/** Le sélecteur de transformation, textes de React (`TRANSFORMATION_OPTIONS`) — sans accents, comme lui. */
export const TRANSFORMATIONS: readonly { valeur: TransformationCapture; libelle: string; aide: string }[] = [
  { valeur: 'union', libelle: 'Union des layers', aide: 'Forme naturelle dissoute (recommande)' },
  { valeur: 'convex_hull', libelle: 'Enveloppe convexe', aide: 'Forme simplifiee englobante' },
  { valeur: 'envelope', libelle: 'Rectangle englobant', aide: 'Bounding box' },
  { valeur: 'raw', libelle: 'Geometrie brute', aide: 'Sans transformation' },
];

/** Ce qu'une couche contributive rend : rien, une géométrie, ou plusieurs (`ContributedGeometry`). */
export type GeometrieContribuee = GeoJSON.Geometry | GeoJSON.Geometry[] | null;

export function aplatir(g: GeometrieContribuee): GeoJSON.Geometry[] {
  if (!g) return [];
  return Array.isArray(g) ? g : [g];
}

const coordonnees = (geoms: readonly GeoJSON.Geometry[]) =>
  geoms.flatMap((g) => ('coordinates' in g ? [g.coordinates] : []));

/** Le nombre de positions de toutes les géométries (« Vertices » de l'aperçu). */
export function compterSommets(geoms: readonly GeoJSON.Geometry[]): number {
  let n = 0;
  const parcourir = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      n += 1;
      return;
    }
    c.forEach(parcourir);
  };
  parcourir(coordonnees(geoms));
  return n;
}

/** L'emprise de toutes les géométries, au millième : « 0.000, 0.000 → 5.000, 7.000 », « — » sans coordonnée. */
export function texteBbox(geoms: readonly GeoJSON.Geometry[]): string {
  const b = bboxDeGeometrie({ coordinates: coordonnees(geoms) });
  return b ? `${b[0].toFixed(3)}, ${b[1].toFixed(3)} → ${b[2].toFixed(3)}, ${b[3].toFixed(3)}` : '—';
}

/** `source_type` de la zone capturée : celui de l'unique couche retenue, sinon `composite`. */
export function sourceTypeCapture(types: readonly string[]): string {
  return types.length === 1 ? types[0] : 'composite';
}

/** Un POI de la bataille, tel que la métadonnée de la couche le porte (`BattlePoiMeta`). */
export interface PoiCapture { poi_id: string; poi_name: string; lat: number; lng: number }

/** La métadonnée d'une couche `isochrone_battle` (`BattleLayerMetadata`) — lue sans en supposer la forme. */
export interface MetaBataille {
  cache_key?: string | null;
  category?: string | null;
  mode?: string | null;
  pois?: PoiCapture[];
  battle_features?: GeoJSON.Feature[];
}

export interface SousZone { name: string; source_ref: string; geometry: GeoJSON.Geometry; default_multiplier: number }

/**
 * Ce qu'une bataille à POI ajoute à la capture (`handleSave`, `CustomGeoCaptureModal.tsx:243-299`) : les POI hissés en
 * tête de `source_metadata`, et — dès deux POI — une sous-zone par POI, la géométrie de son PLUS GRAND palier (qui
 * contient les autres par construction), dans l'ordre des POI. `null` sans POI.
 */
export function enrichissementBataille(meta: MetaBataille): { enrichissement: Record<string, unknown>; sousZones: SousZone[] | null } | null {
  const pois = Array.isArray(meta.pois) ? meta.pois : [];
  if (pois.length === 0) return null;
  const anneaux = meta.battle_features ?? [];
  const paliers = new Set<number>();
  for (const f of anneaux) {
    const palier = Number((f.properties as Record<string, unknown> | null)?.['palier']);
    if (Number.isFinite(palier)) paliers.add(palier);
  }
  const enrichissement = {
    cache_key: meta.cache_key ?? null, category: meta.category ?? null, mode: meta.mode ?? null,
    paliers: [...paliers].sort((a, b) => a - b), poi_count: pois.length, pois,
  };
  if (pois.length < 2) return { enrichissement, sousZones: null };

  const plusGrand = new Map<string, { feature: GeoJSON.Feature; palier: number }>();
  for (const f of anneaux) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const id = String(p['poi_id'] ?? '');
    const palier = Number(p['palier'] ?? 0);
    if (!id || !Number.isFinite(palier)) continue;
    const courant = plusGrand.get(id);
    if (!courant || palier > courant.palier) plusGrand.set(id, { feature: f, palier });
  }
  const sousZones = pois.flatMap((p): SousZone[] => {
    const g = plusGrand.get(p.poi_id)?.feature.geometry;
    return g ? [{ name: p.poi_name, source_ref: p.poi_id, geometry: g, default_multiplier: 1.0 }] : [];
  });
  return { enrichissement, sousZones: sousZones.length >= 2 ? sousZones : null };
}
