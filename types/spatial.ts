/**
 * GENESIS — Spatial & Copilote types
 *
 * Types partagés pour les données géospatiales (isochrones, voronoï,
 * zones, carreaux) et les structures de l'interface copilote.
 */
import type { POI } from './poi';

// ---------------------------------------------------------------------------
// Données géospatiales
// ---------------------------------------------------------------------------

export interface IsochroneData {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  _meta: { mode: string; minutes: number };
  _fromCache?: boolean;
  _cachedAt?: string;
}

export interface VoronoiData {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  _meta?: {
    category: string;
    metropolitaine?: boolean;
    filtre_ville?: string | null;
    filtre_region?: string | null;
    filtre_dept?: string | null;
    mode?: string;
    levels?: number[];
  };
}

export interface BattleData {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  _meta?: {
    category: string;
    minutes: number[];
    nb_cirfa?: number;
  };
}

// ---------------------------------------------------------------------------
// Copilote session
// ---------------------------------------------------------------------------

/** Metadata attachée au ZoneData quand le tool analyze_poi_synergy est utilisé */
export interface SynergyMeta {
  poi_category: string;
  target_demo_col: string;
  target_demo_label: string;
  max_distance_m: number;
  min_audience: number;
  buffer_radius_m: number;
  total_audience: number;
}

export interface ZoneData {
  ville: string;
  rayon_metres: number | null;
  rayon_poi_metres: number | null;
  coordonnees: { lat: number; lng: number };
  pois: POI[];
  nb_pois: number;
  categories: Record<string, number>;
  /** Couleurs custom par catégorie, ex: { lycee: '#000000', cirfa: 'red' } */
  couleur_overrides?: Record<string, string>;
  /** Présent uniquement pour les résultats analyze_poi_synergy */
  _synergy?: SynergyMeta;
}

export interface CarreauxData {
  action: 'afficher_carreaux';
  indicateur: string;
  indicateur_label: string;
  ville?: string;
  coordonnees: { lat: number; lng: number };
}

export interface NetworkCoverageData {
  poi_category: string;
  travel_time_minutes: number;
  mode: string;
  target_demo_column: string;
  target_demo_label: string;
  nb_pois: number;
  coverage: number;
  union_geojson: GeoJSON.Geometry;
  from_cache: boolean;
}

export interface SavedMap {
  id: string;
  name: string;
  ville?: string;
  nb_pois: number;
  created_at: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  zoneData?: ZoneData;
  carreauxData?: CarreauxData;
}

// ---------------------------------------------------------------------------
// Service spatial (lib/spatial/engine.ts)
// ---------------------------------------------------------------------------

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: unknown[];
  _meta?: Record<string, unknown>;
}

export interface SpatialResult {
  reply: string;
  geojson?: GeoJSONFeatureCollection | null;
  analysisType?: 'voronoi' | 'isochrone' | 'proximity' | null;
  savedId?: string | null;
  poiCount?: number;
}
