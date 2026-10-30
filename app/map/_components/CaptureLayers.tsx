'use client';

/**
 * MAGELIAN — Bridge entre les states de /map/page.tsx et le registre Custom Geo Capture.
 *
 * Declare N layers contributifs en fonction de l'etat actuel de la page carte.
 * Les 2 modules externes (admin_filter via FilterPanel, digital_analysis via
 * /map/analyse/digital) sont branches ailleurs. Ici : tout ce qui vit dans /map/page.tsx.
 *
 * Modules branches :
 *   - battle-isochrone     : RPC get_battle_geometry
 *   - radio-coverage       : RPC get_radio_coverage_geometry
 *   - iris-selection       : RPC get_iris_selection_geometry
 *   - carreaux-filosofi    : RPC get_carreaux_capture_geometry (bbox + indicateur)
 *   - tmja-routes          : RPC get_tmja_capture_geometry (bbox + buffer 250m)
 */
import { useCallback, useMemo, useRef } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';
import { useCustomGeoLayer } from '@/lib/custom-geo/useCustomGeoLayer';
import { useCustomGeoCaptureContext } from '@/lib/custom-geo/CustomGeoCaptureContext';
import type { ContributedGeometry } from '@/types/custom-geo';
import type { POI } from '@/types/poi';

/** POI light embarqué dans la metadata du layer battle pour le mode "N zones individuelles". */
export interface BattlePoiMeta {
  poi_id: string;
  poi_name: string;
  lat: number;
  lng: number;
}

import type { ClusterGeoJSON } from './ClusterPanel';

interface Props {
  mapRef: React.MutableRefObject<MaplibreMap | null>;

  // Battle isochrone
  battleCacheKey: string | null;
  /** Features ring du battle_full (1 par POI x palier), pour extraction par POI. */
  battleFeatures?: GeoJSON.Feature[];
  /** Liste des POI du battle (id, nom, lat, lng, categorie). */
  battlePois?: POI[];

  // Cluster POI (capture directe client-side)
  clusterGeoJSON: ClusterGeoJSON | null;
  clustersVisible: boolean;

  // Radio coverage
  radioSelectedId: string | null;
  radioSelectedNom: string | null;
  radioCoverageMode: boolean;

  // IRIS selection
  selectedIrisCode: string | null;

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
  battleFeatures,
  battlePois,
  radioSelectedId,
  radioSelectedNom,
  radioCoverageMode,
  selectedIrisCode,
  carreauxVisible,
  carreauxIndicateur,
  carreauxSelectedBucket,
  tmjaGeoJSON,
  clusterGeoJSON,
  clustersVisible,
}: Props) {
  // getActiveScope est ref-based donc stable (pas de re-render quand le scope change).
  // On le lit a chaque getGeometry() pour avoir la valeur courante.
  const { getActiveScope } = useCustomGeoCaptureContext();
  // ── Battle isochrone ──────────────────────────────────────────────────
  const getBattleGeom = useCallback((): Promise<ContributedGeometry> => {
    if (!battleCacheKey) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/battle', { cache_keys: [battleCacheKey] });
  }, [battleCacheKey]);

  // Liste POI dérivée pour la metadata. Source primaire : battlePois (POI[] hydraté
  // par /map/page.tsx). Fallback : extraction depuis battleFeatures.properties si
  // battlePois est vide (caches v3 sans poisForMap).
  const poisMeta = useMemo<BattlePoiMeta[]>(() => {
    if (battlePois && battlePois.length > 0) {
      return battlePois.map(p => ({ poi_id: p.id, poi_name: p.nom, lat: p.lat, lng: p.lng }));
    }
    if (!battleFeatures || battleFeatures.length === 0) return [];
    const seen = new Map<string, BattlePoiMeta>();
    for (const f of battleFeatures) {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const id = String(props.id ?? props.cirfa_id ?? '');
      if (!id || seen.has(id)) continue;
      const lat = Number(props.lat);
      const lng = Number(props.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      seen.set(id, { poi_id: id, poi_name: String(props.nom ?? id), lat, lng });
    }
    return Array.from(seen.values());
  }, [battlePois, battleFeatures]);

  // Catégorie + mode déduits — categorie depuis le 1er POI, mode parsé depuis cache_key
  // (format `battle_full__<cat>__<mode>__...`). Sert à nommer les zones individuelles.
  const battleCategory = useMemo<string | null>(() => {
    if (battlePois && battlePois[0]?.categorie) return battlePois[0].categorie;
    return null;
  }, [battlePois]);

  const battleMode = useMemo<string | null>(() => {
    if (!battleCacheKey) return null;
    const parts = battleCacheKey.split('__');
    return parts.length >= 3 ? parts[2] : null;
  }, [battleCacheKey]);

  useCustomGeoLayer({
    id: 'map-battle-isochrone',
    sourceType: 'isochrone_battle',
    label: poisMeta.length > 1
      ? `Battle isochrones (${poisMeta.length} POI)`
      : 'Battle isochrones',
    enabled: !!battleCacheKey,
    getGeometry: getBattleGeom,
    metadata: {
      cache_key: battleCacheKey,
      poi_count: poisMeta.length,
      pois: poisMeta,
      // battle_features sert au modal pour extraire la géométrie d'un POI
      // (filter par properties.id puis union des paliers côté client).
      battle_features: battleFeatures ?? [],
      category: battleCategory,
      mode: battleMode,
    },
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

  // ── Carreaux Filosofi (scope > bbox) ──────────────────────────────────
  // zoom_level forcé à 14 : le RPC get_carreaux_by_zoom prend alors la branche
  // "carreaux 200m natifs avec LIMIT" (rapide, GIST + LIMIT direct) au lieu de
  // la branche zoom 8-13 (CTE regex sur idcar + GROUP BY sur tous les carreaux
  // de la bbox = >20s sur bbox urbaine). La capture veut la précision 200m,
  // donc la branche native est aussi la plus appropriée fonctionnellement.
  const getCarreauxGeom = useCallback((): Promise<ContributedGeometry> => {
    const bbox = readBbox(mapRef);
    if (!bbox || !carreauxIndicateur) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/carreaux', {
      bbox,
      zoom_level: 14,
      indicateur: carreauxIndicateur,
      // 1500 carreaux 200m = 60km² de couverture, suffisant pour la plupart
      // des captures. Au-delà la réponse JSONB dépasse 2MB et déclenche le
      // wrapper de cache fetch Next.js dev qui hang (cf. PROMPT.md logs).
      max_rows: 1500,
      admin_scope: getActiveScope(),
    });
  }, [mapRef, carreauxIndicateur, getActiveScope]);

  useCustomGeoLayer({
    id: 'map-carreaux-filosofi',
    sourceType: 'carreaux_filosofi',
    label: carreauxIndicateur ? `Carreaux 200m ${carreauxIndicateur}` : 'Carreaux Filosofi',
    enabled: carreauxVisible && !!carreauxIndicateur,
    getGeometry: getCarreauxGeom,
    metadata: {
      indicateur: carreauxIndicateur,
      selected_bucket: carreauxSelectedBucket,
      admin_scope: getActiveScope(),
    },
  });

  // ── TMJA (scope > bbox, buffer 250m serveur-side) ────────────────────
  const tmjaFeaturesRef = useRef<number>(0);
  tmjaFeaturesRef.current = tmjaGeoJSON?.features.length ?? 0;

  const getTmjaGeom = useCallback((): Promise<ContributedGeometry> => {
    const bbox = readBbox(mapRef);
    if (!bbox) return Promise.resolve(null);
    return fetchGeometryFromRoute('/api/custom-geo/source/tmja', {
      bbox,
      buffer_meters: 250,
      min_tmja: 0,
      admin_scope: getActiveScope(),
    });
  }, [mapRef, getActiveScope]);

  useCustomGeoLayer({
    id: 'map-tmja-routes',
    sourceType: 'tmja_routes',
    label: tmjaGeoJSON ? `Trafic routier (${tmjaGeoJSON.features.length} segments)` : 'Trafic routier',
    enabled: !!tmjaGeoJSON && tmjaGeoJSON.features.length > 0,
    getGeometry: getTmjaGeom,
    metadata: {
      buffer_meters: 250,
      features_count: tmjaGeoJSON?.features.length ?? 0,
      admin_scope: getActiveScope(),
    },
  });

  // ── Clusters POI (capture directe, sans aller-retour serveur) ───────────
  //
  // Les autres modules demandent leur geometrie a une route (la donnee vit en
  // base). Les clusters sont deja charges cote client sous forme de points :
  // les renvoyer au serveur pour qu'il les renvoie serait un aller-retour pour
  // rien.
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

  return null;
}
