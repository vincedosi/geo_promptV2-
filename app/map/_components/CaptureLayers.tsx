'use client';

/**
 * GEOMATIK — Bridge entre les states de /map/page.tsx et le registre Custom Geo Capture.
 *
 * Declare N layers contributifs en fonction de l'etat actuel de la page carte.
 * Les 2 modules externes (admin_filter via FilterPanel, digital_analysis via
 * /map/analyse/digital) sont branches ailleurs. Ici : tout ce qui vit dans /map/page.tsx.
 *
 * Modules branches :
 *   - battle-isochrone     : RPC get_battle_geometry
 *   - poi-clusters         : capture directe client
 *   - radio-coverage       : RPC get_radio_coverage_geometry
 *   - iris-selection       : RPC get_iris_selection_geometry
 *   - voronoi-cells        : RPC get_voronoi_capture_geometry (mode standard V1, TODO V2 routier)
 *   - carreaux-filosofi    : RPC get_carreaux_capture_geometry (bbox + indicateur)
 *   - tmja-routes          : RPC get_tmja_capture_geometry (bbox + buffer 250m)
 */
import { useCallback, useRef } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';
import { useCustomGeoLayer } from '@/lib/custom-geo/useCustomGeoLayer';
import type { ContributedGeometry } from '@/types/custom-geo';
import type { ClusterGeoJSON } from './ClusterPanel';

interface Props {
  mapRef: React.MutableRefObject<MaplibreMap | null>;

  // Battle isochrone
  battleCacheKey: string | null;

  // Cluster POI (capture directe client-side)
  clusterGeoJSON: ClusterGeoJSON | null;
  clustersVisible: boolean;

  // Radio coverage
  radioSelectedId: string | null;
  radioSelectedNom: string | null;
  radioCoverageMode: boolean;

  // IRIS selection
  selectedIrisCode: string | null;

  // Voronoi (mode standard V1 ; TODO V2 mode routier)
  voronoiVisible: boolean;
  voronoiCategory: string;

  // Carreaux Filosofi
  carreauxVisible: boolean;
  carreauxIndicateur: string;
  carreauxSelectedBucket: number | null;

  // TMJA
  tmjaGeoJSON: GeoJSON.FeatureCollection | null;
}

async function fetchGeometryFromRoute(url: string, body: unknown): Promise<ContributedGeometry> {
  const res = await adminFetch(url, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.geometry ?? null) as ContributedGeometry;
}

function readBbox(mapRef: React.MutableRefObject<MaplibreMap | null>): [number, number, number, number] | null {
  const map = mapRef.current;
  if (!map) return null;
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

export function CaptureLayers({
  mapRef,
  battleCacheKey,
  clusterGeoJSON,
  clustersVisible,
  radioSelectedId,
  radioSelectedNom,
  radioCoverageMode,
  selectedIrisCode,
  voronoiVisible,
  voronoiCategory,
  carreauxVisible,
  carreauxIndicateur,
  carreauxSelectedBucket,
  tmjaGeoJSON,
}: Props) {
  // ── Battle isochrone ──────────────────────────────────────────────────
  const getBattleGeom = useCallback((): Promise<ContributedGeometry> => {
    if (!battleCacheKey) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/battle', { cache_keys: [battleCacheKey] });
  }, [battleCacheKey]);

  useCustomGeoLayer({
    id: 'map-battle-isochrone',
    sourceType: 'isochrone_battle',
    label: 'Battle isochrones',
    enabled: !!battleCacheKey,
    getGeometry: getBattleGeom,
    metadata: { cache_key: battleCacheKey },
  });

  // ── Cluster POI (direct) ─────────────────────────────────────────────
  const getClusterGeom = useCallback((): ContributedGeometry => {
    if (!clusterGeoJSON) return null;
    const geoms: GeoJSON.Geometry[] = [];
    for (const f of clusterGeoJSON.features) {
      if (f.geometry) geoms.push(f.geometry as GeoJSON.Geometry);
    }
    return geoms.length > 0 ? geoms : null;
  }, [clusterGeoJSON]);

  useCustomGeoLayer({
    id: 'map-poi-clusters',
    sourceType: 'poi_clusters',
    label: clusterGeoJSON ? `Clusters POI (${clusterGeoJSON.features.length} groupes)` : 'Clusters POI',
    enabled: clustersVisible && !!clusterGeoJSON && clusterGeoJSON.features.length > 0,
    getGeometry: getClusterGeom,
    metadata: { cluster_count: clusterGeoJSON?.features.length ?? 0 },
  });

  // ── Radio coverage ────────────────────────────────────────────────────
  const getRadioGeom = useCallback((): Promise<ContributedGeometry> => {
    if (!radioSelectedId) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/radio', { radio_id: radioSelectedId });
  }, [radioSelectedId]);

  useCustomGeoLayer({
    id: 'map-radio-coverage',
    sourceType: 'radio_coverage',
    label: radioSelectedNom ? `Couverture radio ${radioSelectedNom}` : 'Couverture radio',
    enabled: radioCoverageMode && !!radioSelectedId,
    getGeometry: getRadioGeom,
    metadata: { radio_id: radioSelectedId, radio_name: radioSelectedNom },
  });

  // ── IRIS selection ───────────────────────────────────────────────────
  const getIrisGeom = useCallback((): Promise<ContributedGeometry> => {
    if (!selectedIrisCode) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/iris', { iris_codes: [selectedIrisCode] });
  }, [selectedIrisCode]);

  useCustomGeoLayer({
    id: 'map-iris-selection',
    sourceType: 'iris_selection',
    label: selectedIrisCode ? `IRIS ${selectedIrisCode}` : 'IRIS selectionne',
    enabled: !!selectedIrisCode,
    getGeometry: getIrisGeom,
    metadata: { code_iris: selectedIrisCode },
  });

  // ── Voronoi (mode standard V1 — TODO V2 mode routier) ────────────────
  const getVoronoiGeom = useCallback((): Promise<ContributedGeometry> => {
    if (!voronoiCategory) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/voronoi', {
      category: voronoiCategory,
      metropolitaine: true,
    });
  }, [voronoiCategory]);

  useCustomGeoLayer({
    id: 'map-voronoi-cells',
    sourceType: 'voronoi_cells',
    label: voronoiCategory ? `Voronoi ${voronoiCategory}` : 'Voronoi',
    enabled: voronoiVisible && !!voronoiCategory,
    getGeometry: getVoronoiGeom,
    metadata: { category: voronoiCategory, mode: 'standard' },
  });

  // ── Carreaux Filosofi (bbox + indicateur ; bucket applique en metadata) ──
  const getCarreauxGeom = useCallback((): Promise<ContributedGeometry> => {
    const bbox = readBbox(mapRef);
    if (!bbox || !carreauxIndicateur) return Promise.resolve(null);
    const zoom = mapRef.current?.getZoom() ?? 10;
    return fetchGeometryFromRoute('/api/custom-geo/source/carreaux', {
      bbox,
      zoom_level: Math.max(7, Math.min(18, Math.round(zoom))),
      indicateur: carreauxIndicateur,
      max_rows: 5000,
    });
  }, [mapRef, carreauxIndicateur]);

  useCustomGeoLayer({
    id: 'map-carreaux-filosofi',
    sourceType: 'carreaux_filosofi',
    label: carreauxIndicateur ? `Carreaux 200m ${carreauxIndicateur}` : 'Carreaux Filosofi',
    enabled: carreauxVisible && !!carreauxIndicateur,
    getGeometry: getCarreauxGeom,
    metadata: {
      indicateur: carreauxIndicateur,
      selected_bucket: carreauxSelectedBucket,
    },
  });

  // ── TMJA (buffer 250m serveur-side) ──────────────────────────────────
  const tmjaFeaturesRef = useRef<number>(0);
  tmjaFeaturesRef.current = tmjaGeoJSON?.features.length ?? 0;

  const getTmjaGeom = useCallback((): Promise<ContributedGeometry> => {
    const bbox = readBbox(mapRef);
    if (!bbox) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/tmja', {
      bbox,
      buffer_meters: 250,
      min_tmja: 0,
    });
  }, [mapRef]);

  useCustomGeoLayer({
    id: 'map-tmja-routes',
    sourceType: 'tmja_routes',
    label: tmjaGeoJSON ? `Trafic routier (${tmjaGeoJSON.features.length} segments)` : 'Trafic routier',
    enabled: !!tmjaGeoJSON && tmjaGeoJSON.features.length > 0,
    getGeometry: getTmjaGeom,
    metadata: {
      buffer_meters: 250,
      features_count: tmjaGeoJSON?.features.length ?? 0,
    },
  });

  return null;
}
