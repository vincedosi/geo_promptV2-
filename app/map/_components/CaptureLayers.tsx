'use client';

/**
 * GEOMATIK — Bridge entre les states de /map/page.tsx et le registre Custom Geo Capture.
 *
 * Declare 4 layers contributifs en fonction de l'etat actuel de la page carte :
 *   - battle-isochrone     : RPC get_battle_geometry via POST /api/custom-geo/source/battle
 *   - poi-cluster          : capture directe depuis le FeatureCollection deja en memoire
 *   - radio-coverage       : RPC get_radio_coverage_geometry via POST /api/custom-geo/source/radio
 *   - iris-selection       : RPC get_iris_selection_geometry via POST /api/custom-geo/source/iris
 *
 * Admin filter branche a part dans FilterPanel (state selectedDepts/Regions local).
 * Digital zone branche dans /map/analyse/digital/page.tsx.
 */
import { useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useCustomGeoLayer } from '@/lib/custom-geo/useCustomGeoLayer';
import type { ContributedGeometry } from '@/types/custom-geo';
import type { ClusterGeoJSON } from './ClusterPanel';

interface Props {
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

export function CaptureLayers({
  battleCacheKey,
  clusterGeoJSON,
  clustersVisible,
  radioSelectedId,
  radioSelectedNom,
  radioCoverageMode,
  selectedIrisCode,
}: Props) {
  // ── Battle isochrone ──────────────────────────────────────────────────
  const getBattleGeom = useCallback((): Promise<ContributedGeometry> => {
    if (!battleCacheKey) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/battle', {
      cache_keys: [battleCacheKey],
    });
  }, [battleCacheKey]);

  useCustomGeoLayer({
    id: 'map-battle-isochrone',
    sourceType: 'isochrone_battle',
    label: 'Battle isochrones',
    enabled: !!battleCacheKey,
    getGeometry: getBattleGeom,
    metadata: { cache_key: battleCacheKey },
  });

  // ── Cluster POI (direct, pas de RPC) ──────────────────────────────────
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
    label: clusterGeoJSON
      ? `Clusters POI (${clusterGeoJSON.features.length} groupes)`
      : 'Clusters POI',
    enabled: clustersVisible && !!clusterGeoJSON && clusterGeoJSON.features.length > 0,
    getGeometry: getClusterGeom,
    metadata: { cluster_count: clusterGeoJSON?.features.length ?? 0 },
  });

  // ── Radio coverage ─────────────────────────────────────────────────────
  const getRadioGeom = useCallback((): Promise<ContributedGeometry> => {
    if (!radioSelectedId) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/radio', {
      radio_id: radioSelectedId,
    });
  }, [radioSelectedId]);

  useCustomGeoLayer({
    id: 'map-radio-coverage',
    sourceType: 'radio_coverage',
    label: radioSelectedNom
      ? `Couverture radio ${radioSelectedNom}`
      : 'Couverture radio',
    enabled: radioCoverageMode && !!radioSelectedId,
    getGeometry: getRadioGeom,
    metadata: { radio_id: radioSelectedId, radio_name: radioSelectedNom },
  });

  // ── IRIS selection ─────────────────────────────────────────────────────
  const getIrisGeom = useCallback((): Promise<ContributedGeometry> => {
    if (!selectedIrisCode) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/iris', {
      iris_codes: [selectedIrisCode],
    });
  }, [selectedIrisCode]);

  useCustomGeoLayer({
    id: 'map-iris-selection',
    sourceType: 'iris_selection',
    label: selectedIrisCode ? `IRIS ${selectedIrisCode}` : 'IRIS selectionne',
    enabled: !!selectedIrisCode,
    getGeometry: getIrisGeom,
    metadata: { code_iris: selectedIrisCode },
  });

  return null;
}
