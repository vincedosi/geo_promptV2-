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

export interface ZoneData {
  ville: string;
  rayon_metres: number | null;
  rayon_poi_metres: number | null;
  coordonnees: { lat: number; lng: number };
  pois: POI[];
  nb_pois: number;
  categories: Record<string, number>;
}

export interface CarreauxData {
  action: 'afficher_carreaux';
  indicateur: string;
  indicateur_label: string;
  ville?: string;
  coordonnees: { lat: number; lng: number };
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
