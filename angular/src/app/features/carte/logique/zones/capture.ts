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

/**
 * Le sélecteur de transformation (`TRANSFORMATION_OPTIONS` de React). Preuve T7 (D-7) : accentué — React écrit ces textes
 * sans accents ; la langue de l'interface prime sur la recopie lettre à lettre.
 */
export const TRANSFORMATIONS: readonly { valeur: TransformationCapture; libelle: string; aide: string }[] = [
  { valeur: 'union', libelle: 'Union des layers', aide: 'Forme naturelle dissoute (recommandé)' },
  { valeur: 'convex_hull', libelle: 'Enveloppe convexe', aide: 'Forme simplifiée englobante' },
  { valeur: 'envelope', libelle: 'Rectangle englobant', aide: 'Bounding box' },
  { valeur: 'raw', libelle: 'Géométrie brute', aide: 'Sans transformation' },
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

/**
 * Une sous-zone de bataille : TOUTES les géométries du POI (`geometries`), que `/api/custom-geo/capture` unit en base
 * (`transform_geometries_for_save`, `union`) avant de l'écrire — une seule forme, la zone entière atteignable du POI.
 */
export interface SousZone { name: string; source_ref: string; geometries: GeoJSON.Geometry[]; default_multiplier: number }

/**
 * Ce qu'une bataille à POI ajoute à la capture (`handleSave`, `CustomGeoCaptureModal.tsx:243-299`) : les POI hissés en
 * tête de `source_metadata`, et — dès deux POI — une sous-zone par POI portant TOUS ses anneaux, dans l'ordre des POI.
 * `null` sans POI.
 *
 * Preuve T7 (D-1) : on ne garde plus le seul plus grand palier. Il ne contient les autres que pour la V1 (isochrones
 * emboîtées) ; la V2 (`get_isochrone_battle`) rend des BANDES disjointes (`ST_Difference`), et son plus grand palier
 * n'en est que l'anneau extérieur — 7 056 km² de sous-zones pour une zone de 25 130 km² en Bretagne, 720 IRIS au
 * lieu de 1 799. L'union de toutes les bandes vaut, dans les deux cas, la zone entière du POI ; elle est faite en base
 * par la route, aucune bibliothèque d'opérations booléennes n'étant embarquée côté client.
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

  const parPoi = new Map<string, GeoJSON.Geometry[]>();
  for (const f of anneaux) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    // Les anneaux de la V2 (`get_isochrone_battle`) portent le POI sous `cirfa_id`, ceux de la V1 sous `poi_id` (T4).
    const id = String(p['poi_id'] ?? p['cirfa_id'] ?? '');
    if (!id || !f.geometry) continue;
    const liste = parPoi.get(id);
    if (liste) liste.push(f.geometry);
    else parPoi.set(id, [f.geometry]);
  }
  const sousZones = pois.flatMap((p): SousZone[] => {
    const geometries = parPoi.get(p.poi_id);
    return geometries ? [{ name: p.poi_name, source_ref: p.poi_id, geometries, default_multiplier: 1.0 }] : [];
  });
  return { enrichissement, sousZones: sousZones.length >= 2 ? sousZones : null };
}
