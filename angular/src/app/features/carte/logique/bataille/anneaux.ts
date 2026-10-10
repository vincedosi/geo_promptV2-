/**
 * Logique PURE du rendu d'une bataille d'isochrones — portage d'`applyIsochroneBattle`, d'`addBattlePartialRings`
 * (`app/copilote/_hooks/useMapLayers.ts:975-1159`) et des filtres de `useMapLayers.ts:240-269` (lot 4, T14 puis T17).
 *
 * Une teinte par POI, dans l'ordre d'apparition (`VORONOI_PALETTE` en cycle) ; une opacité par palier
 * (`BATTLE_PALIER_OPACITY`, `0.20` pour un palier inconnu, `0.15` pour un anneau encore brut) ; un point par POI.
 */
import { bboxDeGeometrie } from '../zones/zones-affichees';
import { BATTLE_PALIER_OPACITY, OPACITE_PALIER_INCONNU, OPACITE_PALIER_PARTIEL, VORONOI_PALETTE } from '../palettes-donnees-carte';
import type { AnneauBrut } from './flux';

/** Un POI de bataille tel que la carte le pointe (`poisForMap`, `useMapLayers.ts:1033`). */
export interface PoiBataille {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  adresse?: string;
  ville?: string;
}

/** Une entrée de la légende de bataille (`battlePois` de `useMapLayers`). */
export interface LegendeBataille {
  id: string;
  nom: string;
  color: string;
}

/** L'identifiant de POI d'un anneau : `id` (v2) ou `cirfa_id` (v1), `useMapLayers.ts:1043-1044`. */
function idPoi(f: GeoJSON.Feature): string {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  return String(p['id'] ?? p['cirfa_id'] ?? '');
}

/**
 * Les anneaux colorés (`battle_color`, `battle_opacity` ajoutés aux propriétés) et la légende — une entrée par POI,
 * dans l'ordre d'apparition (`useMapLayers.ts:1039-1063`, `:1126-1136`).
 */
export function stylerAnneaux(anneaux: readonly GeoJSON.Feature[]): { anneaux: GeoJSON.Feature[]; legende: LegendeBataille[] } {
  const couleurs = new Map<string, string>();
  for (const f of anneaux) {
    const cid = idPoi(f);
    if (cid && !couleurs.has(cid)) couleurs.set(cid, VORONOI_PALETTE[couleurs.size % VORONOI_PALETTE.length]);
  }
  const styles = anneaux.map((f): GeoJSON.Feature & { properties: Record<string, unknown> } => {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const palier = Number(p['palier'] ?? 120);
    return {
      ...f,
      properties: {
        ...p,
        battle_color: couleurs.get(idPoi(f)) ?? VORONOI_PALETTE[0],
        battle_opacity: BATTLE_PALIER_OPACITY[palier] ?? OPACITE_PALIER_INCONNU,
      },
    };
  });
  const vus = new Set<string>();
  const legende: LegendeBataille[] = [];
  for (const f of styles) {
    const cid = String(f.properties['id'] ?? '');
    if (!cid || vus.has(cid)) continue;
    vus.add(cid);
    legende.push({ id: cid, nom: String(f.properties['nom'] ?? cid), color: couleurs.get(cid) ?? VORONOI_PALETTE[0] });
  }
  return { anneaux: styles, legende };
}

/**
 * Les points des POI (`useMapLayers.ts:1089-1099`) : un point par POI aux coordonnées finies et NON NULLES — React
 * écarte `lat`/`lng` à 0, ce qui est aussi ce qui écarte un centre absent.
 */
export function pointsBataille(pois: readonly PoiBataille[]): GeoJSON.Feature[] {
  return pois
    .filter((p) => !Number.isNaN(p.lat) && !Number.isNaN(p.lng) && p.lat && p.lng)
    .map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { nom: p.nom, adresse: p.adresse ?? '', ville: p.ville ?? '', id: p.id },
    }));
}

/**
 * Les anneaux BRUTS reçus avant la découpe (`addBattlePartialRings`, `useMapLayers.ts:975-1013`), ajoutés à ceux déjà
 * affichés : la palette CONTINUE d'un lot à l'autre (un POI garde sa teinte), chaque anneau est marqué `_partial`.
 */
export function stylerPartiels(existants: readonly GeoJSON.Feature[], bruts: readonly AnneauBrut[]): GeoJSON.Feature[] {
  const couleurs = new Map<string, string>();
  for (const f of existants) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const cid = String(p['cirfa_id'] ?? p['id'] ?? '');
    if (cid && !couleurs.has(cid)) couleurs.set(cid, VORONOI_PALETTE[couleurs.size % VORONOI_PALETTE.length]);
  }
  const nouveaux = bruts.map((r): GeoJSON.Feature => {
    if (!couleurs.has(r.cirfa_id)) couleurs.set(r.cirfa_id, VORONOI_PALETTE[couleurs.size % VORONOI_PALETTE.length]);
    return {
      type: 'Feature',
      geometry: r.geojson as GeoJSON.Geometry,
      properties: {
        id: r.cirfa_id, cirfa_id: r.cirfa_id, nom: r.nom, lat: r.lat, lng: r.lng, palier: r.palier,
        battle_color: couleurs.get(r.cirfa_id), battle_opacity: BATTLE_PALIER_OPACITY[r.palier] ?? OPACITE_PALIER_PARTIEL,
        _partial: true,
      },
    };
  });
  return [...existants, ...nouveaux];
}

const SANS_BORDURE = ['!=', ['get', 'feature_type'], 'border'];
const PALIER_ZERO = ['==', ['get', 'palier'], 0];

/**
 * Le filtre des anneaux : jamais une bordure en aplat ; le palier 0 (le « Voronoï » résiduel, hors de portée de tout
 * isochrone) seulement si on le demande ; rien au-delà du palier maximum. Défaut React corrigé : deux effets posaient
 * chacun SON filtre sur les mêmes couches (`useMapLayers.ts:240-269`), le dernier gagnait — régler le palier maximum
 * rallumait le palier 0, cocher « Voronoï » oubliait le palier maximum. Un seul filtre ici, qui combine les deux.
 */
export function filtreAnneaux(contourVisible: boolean, palierMax: number): unknown[] {
  const maximum = ['<=', ['get', 'palier'], palierMax];
  return contourVisible
    ? ['all', SANS_BORDURE, ['any', PALIER_ZERO, maximum]]
    : ['all', SANS_BORDURE, ['!=', ['get', 'palier'], 0], maximum];
}

/** Les POI repris des anneaux quand la route n'en fournit pas (`useMapLayers.ts:1102-1117`) : un par id, coordonnées valides. */
export function poisDesAnneaux(anneaux: readonly GeoJSON.Feature[]): PoiBataille[] {
  const vus = new Set<string>();
  const pois: PoiBataille[] = [];
  for (const f of anneaux) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const id = String(p['id'] ?? p['cirfa_id'] ?? '');
    const lat = Number(p['lat']);
    const lng = Number(p['lng']);
    if (!id || vus.has(id) || Number.isNaN(lat) || Number.isNaN(lng) || !lat || !lng) continue;
    vus.add(id);
    pois.push({ id, nom: String(p['nom'] ?? ''), lat, lng, adresse: p['adresse'] as string | undefined, ville: p['ville'] as string | undefined });
  }
  return pois;
}

/** L'emprise des anneaux — polygones et multipolygones seulement (`useMapLayers.ts:1138-1156`) ; `null` sans coordonnée. */
export function empriseAnneaux(anneaux: readonly GeoJSON.Feature[]): [[number, number], [number, number]] | null {
  const coordonnees = anneaux
    .map((f) => f.geometry)
    .filter((g): g is GeoJSON.Polygon | GeoJSON.MultiPolygon => g?.type === 'Polygon' || g?.type === 'MultiPolygon')
    .map((g) => g.coordinates);
  const b = bboxDeGeometrie({ coordinates: coordonnees });
  return b ? [[b[0], b[1]], [b[2], b[3]]] : null;
}
