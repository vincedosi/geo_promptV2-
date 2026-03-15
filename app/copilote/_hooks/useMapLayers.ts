'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import {
  applyChoropleth,
  ISOCHRONE_COLORS,
  VORONOI_PALETTE,
  BATTLE_PALIER_OPACITY,
} from '../_lib/constants';
import type { IsochroneData, VoronoiData, CarreauxData } from '@/types/spatial';

interface UseMapLayersOpts {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  mapReady: boolean;
  isochroneDataForSaveRef: React.MutableRefObject<IsochroneData | null>;
  carreauxConfigForSaveRef: React.MutableRefObject<{
    tableName: string; indicateur: string; indicateur_label: string; coordonnees: { lat: number; lng: number };
  } | null>;
  voronoiDataForSaveRef: React.MutableRefObject<VoronoiData | null>;
  setSaveName: (name: string) => void;
}

export function useMapLayers({
  mapRef,
  mapReady,
  isochroneDataForSaveRef,
  carreauxConfigForSaveRef,
  voronoiDataForSaveRef,
  setSaveName,
}: UseMapLayersOpts) {
  // Voronoï
  const [voronoiVisible,  setVoronoiVisible]  = useState(false);
  const [voronoiCategory, setVoronoiCategory] = useState('');
  const [voronoiCirfas,   setVoronoiCirfas]   = useState<{ id: string; nom: string; color: string }[]>([]);

  // Bataille d'Isochrones
  const [battleVisible,  setBattleVisible]  = useState(false);
  const [battleCategory, setBattleCategory] = useState('');
  const [battleCirfas,   setBattleCirfas]   = useState<{ id: string; nom: string; color: string }[]>([]);

  // Test ORS
  const [testIsoVisible, setTestIsoVisible] = useState(false);
  const [testIsoLoading, setTestIsoLoading] = useState(false);
  const [testIsoDebug,   setTestIsoDebug]   = useState('');

  // Isochrones
  const [isochroneVisible,   setIsochroneVisible]   = useState(false);
  const [isochroneMode,      setIsochroneMode]      = useState('walk');
  const [isochroneMinutes,   setIsochroneMinutes]   = useState(0);
  const [isochroneFromCache, setIsochroneFromCache] = useState(false);
  const [isochroneCachedAt,  setIsochroneCachedAt]  = useState('');
  const lastIsochroneDataRef = useRef<IsochroneData | null>(null);

  // Carreaux
  const [carreauxVisible,    setCarreauxVisible]    = useState(false);
  const [carreauxLoaded,     setCarreauxLoaded]     = useState(false);
  const [carreauxIndicateur, setCarreauxIndicateur] = useState('');
  const [carreauxLabel,      setCarreauxLabel]      = useState('');
  const [carreauxSources,    setCarreauxSources]    = useState<{ tableName: string; name: string }[]>([]);
  const carreauxSourcesRef = useRef<{ tableName: string; name: string }[]>([]);
  const carreauxDataRef    = useRef<GeoJSON.FeatureCollection | null>(null);

  // Sync ref
  useEffect(() => { carreauxSourcesRef.current = carreauxSources; }, [carreauxSources]);

  // Load carreaux sources on mount
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/carreaux', { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (data.sources?.length > 0) {
          setCarreauxSources(data.sources);
          carreauxSourcesRef.current = data.sources;
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // ── Visibility toggles ────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = voronoiVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('voronoi-fill',       'visibility', vis);
      map.setLayoutProperty('voronoi-line',       'visibility', vis);
      map.setLayoutProperty('voronoi-pois-halo',  'visibility', vis);
      map.setLayoutProperty('voronoi-pois-circle','visibility', vis);
    } catch { /* layer pas encore prêt */ }
  }, [voronoiVisible, mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = battleVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('battle-fill',         'visibility', vis);
      map.setLayoutProperty('battle-ring-line',    'visibility', vis);
      map.setLayoutProperty('battle-cirfa-border', 'visibility', vis);
      map.setLayoutProperty('battle-pois-halo',    'visibility', vis);
      map.setLayoutProperty('battle-pois-circle',  'visibility', vis);
    } catch { /* layer pas encore prêt */ }
  }, [battleVisible, mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = testIsoVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('test-iso-fill', 'visibility', vis);
      map.setLayoutProperty('test-iso-line', 'visibility', vis);
    } catch {}
  }, [testIsoVisible, mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = isochroneVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('isochrones-fill', 'visibility', vis);
      map.setLayoutProperty('isochrones-line', 'visibility', vis);
    } catch { /* layer pas encore ajouté */ }
  }, [isochroneVisible, mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const vis = carreauxVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('carreaux-fill', 'visibility', vis);
      map.setLayoutProperty('carreaux-line', 'visibility', vis);
    } catch { /* layer not yet added */ }

    if (carreauxVisible && !carreauxLoaded) {
      (async () => {
        try {
          const listRes = await fetch('/api/carreaux');
          const listData = await listRes.json();
          if (!listData.sources || listData.sources.length === 0) return;

          const tableName = listData.sources[0].tableName;
          const gjRes = await fetch('/api/carreaux', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableName }),
          });
          const gjData = await gjRes.json();
          if (!gjData.features) return;

          carreauxDataRef.current = gjData as GeoJSON.FeatureCollection;
          setCarreauxLoaded(true);

          const source = map.getSource('carreaux') as maplibregl.GeoJSONSource | undefined;
          if (source) {
            source.setData(gjData as GeoJSON.FeatureCollection);
            const skipKeys = new Set(['idcar', 'x', 'y', 'gml_id', 'objectid']);
            let choroKey = '';
            const sampleProps = (gjData.features[0]?.properties || {}) as Record<string, unknown>;
            for (const [k, v] of Object.entries(sampleProps)) {
              if (skipKeys.has(k)) continue;
              if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '')) {
                choroKey = k;
                break;
              }
            }
            if (choroKey) {
              const vals = gjData.features
                .map((f: GeoJSON.Feature) => Number((f.properties as Record<string, unknown>)?.[choroKey]))
                .filter((n: number) => !isNaN(n));
              const mn = Math.min(...vals);
              const mx = Math.max(...vals);
              if (mx > mn) {
                const step = (mx - mn) / 4;
                map.setPaintProperty('carreaux-fill', 'fill-color', [
                  'interpolate', ['linear'],
                  ['coalesce', ['to-number', ['get', choroKey], 0], 0],
                  mn, '#f7fbff',
                  mn + step, '#c6dbef',
                  mn + 2 * step, '#6baed6',
                  mn + 3 * step, '#2171b5',
                  mx, '#08306b',
                ] as unknown as maplibregl.ExpressionSpecification);
              }
            }
          }
        } catch (err) {
          console.error('[Copilote] carreaux error:', err);
        }
      })();
    }
  }, [carreauxVisible, carreauxLoaded, mapReady, mapRef]);

  // ── Visualization functions ───────────────────────────────────────────────

  const applyVoronoi = (vData: VoronoiData) => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    voronoiDataForSaveRef.current = vData;
    const meta = vData._meta;
    const geo  = meta?.filtre_region ?? meta?.filtre_ville ?? meta?.filtre_dept ?? '';
    setSaveName(`Voronoï ${meta?.category ?? ''} ${geo}`.trim().replace(/\s+/g, ' '));

    const cirfaColorMap = new Map<string, string>();
    let _colorIdx = 0;
    for (const f of vData.features) {
      const cid = String((f.properties as Record<string, unknown>)?.id ?? '');
      if (cid && !cirfaColorMap.has(cid)) {
        cirfaColorMap.set(cid, VORONOI_PALETTE[_colorIdx % VORONOI_PALETTE.length]);
        _colorIdx++;
      }
    }

    const featuresWithColors = vData.features.map((f) => {
      const cid = String((f.properties as Record<string, unknown>)?.id ?? '');
      const voronoi_color = cirfaColorMap.get(cid) ?? VORONOI_PALETTE[0];
      return { ...f, properties: { ...f.properties, voronoi_color } };
    });

    const source = map.getSource('voronoi') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData({ type: 'FeatureCollection', features: featuresWithColors } as GeoJSON.FeatureCollection);
    map.setLayoutProperty('voronoi-fill', 'visibility', 'visible');
    map.setLayoutProperty('voronoi-line', 'visibility', 'visible');
    setVoronoiVisible(true);
    setVoronoiCategory(vData._meta?.category ?? '');

    const poisSeen = new Set<string>();
    const poiFeatures: GeoJSON.Feature[] = [];
    for (const f of featuresWithColors) {
      const p = f.properties as Record<string, unknown>;
      const pid = String(p.id ?? '');
      const plat = Number(p.lat);
      const plng = Number(p.lng);
      if (pid && !poisSeen.has(pid) && !isNaN(plat) && !isNaN(plng) && plat && plng) {
        poisSeen.add(pid);
        poiFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [plng, plat] },
          properties: { nom: p.nom, categorie: p.categorie, adresse: p.adresse, ville: p.ville, id: pid },
        });
      }
    }

    const poisSource = map.getSource('voronoi-pois') as maplibregl.GeoJSONSource | undefined;
    if (poisSource) {
      poisSource.setData({ type: 'FeatureCollection', features: poiFeatures });
      if (poiFeatures.length > 0) {
        try {
          map.setLayoutProperty('voronoi-pois-halo',   'visibility', 'visible');
          map.setLayoutProperty('voronoi-pois-circle', 'visibility', 'visible');
        } catch {}
      }
    }

    const _cirfaSeen = new Set<string>();
    const cirfaLegend: { id: string; nom: string; color: string }[] = [];
    for (const f of featuresWithColors) {
      const p = f.properties as Record<string, unknown>;
      const cid = String(p?.id ?? '');
      if (cid && !_cirfaSeen.has(cid)) {
        _cirfaSeen.add(cid);
        cirfaLegend.push({ id: cid, nom: String(p?.nom ?? cid), color: cirfaColorMap.get(cid) ?? VORONOI_PALETTE[0] });
      }
    }
    setVoronoiCirfas(cirfaLegend);

    if (featuresWithColors.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      let extended = false;
      for (const f of featuresWithColors) {
        const geom = (f as GeoJSON.Feature<GeoJSON.Polygon>).geometry;
        if (!geom || geom.type !== 'Polygon') continue;
        for (const coord of geom.coordinates.flat()) {
          bounds.extend([coord[0], coord[1]]);
          extended = true;
        }
      }
      if (extended) map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 1200 });
    }
  };

  const applyIsochroneBattle = (
    ringData:   { type: string; features: GeoJSON.Feature[] },
    borderData: { type: string; features: GeoJSON.Feature[] } | null | undefined,
    category?:  string,
    poisForMap?: { id: string; nom: string; lat: number; lng: number; adresse?: string; ville?: string }[]
  ) => {
    const map = mapRef.current;
    if (!map) return;

    const cirfaColorMap = new Map<string, string>();
    let _colorIdx = 0;
    for (const f of ringData.features) {
      const p   = f.properties as Record<string, unknown>;
      // Support: 'id' (v2) ou 'cirfa_id' (v1 éventuelle)
      const cid = String(p?.id ?? p?.cirfa_id ?? '');
      if (cid && !cirfaColorMap.has(cid)) {
        cirfaColorMap.set(cid, VORONOI_PALETTE[_colorIdx % VORONOI_PALETTE.length]);
        _colorIdx++;
      }
    }

    const styledRings = ringData.features.map((f) => {
      const p      = f.properties as Record<string, unknown>;
      const cid    = String(p?.id ?? p?.cirfa_id ?? '');
      const palier = Number(p?.palier ?? 120);
      return {
        ...f,
        properties: {
          ...p,
          battle_color:   cirfaColorMap.get(cid) ?? VORONOI_PALETTE[0],
          battle_opacity: BATTLE_PALIER_OPACITY[palier] ?? 0.18,
        },
      };
    });

    const ringSrc = map.getSource('battle-rings') as maplibregl.GeoJSONSource | undefined;
    if (!ringSrc) return;
    ringSrc.setData({ type: 'FeatureCollection', features: styledRings } as GeoJSON.FeatureCollection);

    const borderSrc = map.getSource('battle-borders') as maplibregl.GeoJSONSource | undefined;
    if (borderSrc && borderData?.features?.length) {
      borderSrc.setData(borderData as unknown as GeoJSON.FeatureCollection);
      try { map.setLayoutProperty('battle-cirfa-border', 'visibility', 'visible'); } catch {}
    }

    try {
      map.setLayoutProperty('battle-fill',      'visibility', 'visible');
      map.setLayoutProperty('battle-ring-line', 'visibility', 'visible');
    } catch {}
    setBattleVisible(true);
    setBattleCategory(category ?? '');

    // Utiliser poisForMap (tous les CIRFAs) si disponible,
    // sinon extraire des ring features (peut rater des CIRFAs sans territoire).
    const poiFeatures: GeoJSON.Feature[] = [];
    if (poisForMap && poisForMap.length > 0) {
      for (const p of poisForMap) {
        if (!isNaN(p.lat) && !isNaN(p.lng) && p.lat && p.lng) {
          poiFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: { nom: p.nom, adresse: p.adresse ?? '', ville: p.ville ?? '', id: p.id },
          });
        }
      }
    } else {
      const poisSeen = new Set<string>();
      for (const f of ringData.features) {
        const p = f.properties as Record<string, unknown>;
        const pid  = String(p.id ?? p.cirfa_id ?? '');
        const plat = Number(p.lat);
        const plng = Number(p.lng);
        if (pid && !poisSeen.has(pid) && !isNaN(plat) && !isNaN(plng) && plat && plng) {
          poisSeen.add(pid);
          poiFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [plng, plat] },
            properties: { nom: p.nom, adresse: p.adresse, ville: p.ville, id: pid },
          });
        }
      }
    }
    const poisSrc = map.getSource('battle-pois') as maplibregl.GeoJSONSource | undefined;
    if (poisSrc && poiFeatures.length > 0) {
      poisSrc.setData({ type: 'FeatureCollection', features: poiFeatures });
      try {
        map.setLayoutProperty('battle-pois-halo',   'visibility', 'visible');
        map.setLayoutProperty('battle-pois-circle', 'visibility', 'visible');
      } catch {}
    }

    const _seen = new Set<string>();
    const legend: { id: string; nom: string; color: string }[] = [];
    for (const f of styledRings) {
      const p = f.properties as Record<string, unknown>;
      const cid = String(p?.id ?? '');
      if (cid && !_seen.has(cid)) {
        _seen.add(cid);
        legend.push({ id: cid, nom: String(p?.nom ?? cid), color: cirfaColorMap.get(cid) ?? VORONOI_PALETTE[0] });
      }
    }
    setBattleCirfas(legend);

    if (styledRings.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      let extended = false;
      for (const f of styledRings) {
        const geom = (f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>).geometry;
        if (!geom) continue;
        const coordRings = geom.type === 'MultiPolygon'
          ? geom.coordinates.flat(1)
          : geom.type === 'Polygon' ? geom.coordinates : [];
        for (const ring of coordRings) {
          for (const coord of ring) {
            bounds.extend([coord[0], coord[1]]);
            extended = true;
          }
        }
      }
      if (extended) map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 1200 });
    }
  };

  const applyIsochrones = (isoData: IsochroneData) => {
    const map = mapRef.current;
    if (!map) return;

    const mode   = isoData._meta?.mode ?? 'walk';
    const colors = ISOCHRONE_COLORS[mode] ?? ISOCHRONE_COLORS.walk;

    const source = map.getSource('isochrones') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData(isoData as unknown as GeoJSON.FeatureCollection);
    map.setPaintProperty('isochrones-fill', 'fill-color', colors.fill);
    map.setPaintProperty('isochrones-line', 'line-color', colors.line);
    map.setLayoutProperty('isochrones-fill', 'visibility', 'visible');
    map.setLayoutProperty('isochrones-line', 'visibility', 'visible');

    setIsochroneMode(mode);
    setIsochroneMinutes(isoData._meta?.minutes ?? 0);
    setIsochroneFromCache(isoData._fromCache ?? false);
    setIsochroneCachedAt(isoData._cachedAt ?? '');
    setIsochroneVisible(true);

    lastIsochroneDataRef.current    = isoData;
    isochroneDataForSaveRef.current = isoData;
  };

  const loadCarreauxFromAI = async (cd: CarreauxData) => {
    const map     = mapRef.current;
    const sources = carreauxSourcesRef.current;
    if (!map) return;

    // Fallback sur carreaux_filosofi si data_sources n'a pas encore d'entrée carreaux
    const tableName = sources.length > 0 ? sources[0].tableName : 'carreaux_filosofi';
    const { lat, lng } = cd.coordonnees;

    const dlat = cd.rayon_km ? cd.rayon_km / 111.32 : 0.04; // configurable, défaut ≈4.5km
    const dlng = (cd.rayon_km ? cd.rayon_km / 111.32 : 0.055) / Math.cos(lat * Math.PI / 180);
    const bbox = [lng - dlng, lat - dlat, lng + dlng, lat + dlat];

    try {
      // Fly and fetch in parallel — don't wait for moveend (can silently hang)
      map.flyTo({ center: [lng, lat], zoom: 12, duration: 1000 });

      const gjData = await fetch('/api/carreaux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName, bbox, resolution: cd.resolution ?? '200m' }),
      }).then(r => r.json());

      console.log('[Copilote] carreaux response:', {
        count: gjData.features?.length,
        error: gjData.error,
        indicateur: cd.indicateur,
        sampleProps: gjData.features?.[0]?.properties,
      });
      if (!gjData.features || gjData.features.length === 0) {
        console.warn('[Copilote] Aucun carreau dans la bbox');
        return;
      }

      const source = map.getSource('carreaux') as maplibregl.GeoJSONSource | undefined;
      console.log('[Copilote] carreaux source exists:', !!source);
      if (!source) return;

      source.setData(gjData as GeoJSON.FeatureCollection);
      applyChoropleth(map, gjData.features, cd.indicateur);
      console.log('[Copilote] choropleth applied, setting visible');
      map.setLayoutProperty('carreaux-fill', 'visibility', 'visible');
      map.setLayoutProperty('carreaux-line', 'visibility', 'visible');

      // Force a repaint after data is loaded
      map.triggerRepaint();

      setCarreauxVisible(true);
      setCarreauxLoaded(true);
      setCarreauxIndicateur(cd.indicateur);
      setCarreauxLabel(cd.indicateur_label + ` (${gjData.features.length} carreaux)`);
    } catch (err) {
      console.error('[Copilote] loadCarreauxFromAI error:', err);
    }
  };

  const runTestIsochrone = async (
    region   = 'Bretagne',
    category = 'cirfa',
    minutes  = 10,
    mode     = 'drive'
  ) => {
    const map = mapRef.current;
    if (!map || testIsoLoading) return;

    setTestIsoLoading(true);
    setTestIsoDebug('Appel ORS en cours…');

    try {
      const url = `/api/test-isochrone?region=${encodeURIComponent(region)}&category=${encodeURIComponent(category)}&minutes=${minutes}&mode=${mode}`;
      const res  = await fetch(url);
      const data = await res.json();

      if (!res.ok || data.error) {
        setTestIsoDebug(`❌ ${data.error ?? 'Erreur inconnue'}`);
        return;
      }

      const src = map.getSource('test-iso') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data as GeoJSON.FeatureCollection);
        setTestIsoVisible(true);
      }

      const d = data._debug;
      setTestIsoDebug(
        `${d?.message ?? '?'} | ${d?.tested_count ?? '?'} CIRFAs testés / ${d?.poi_count ?? '?'} trouvés`
      );

      if (data.features?.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        let extended = false;
        for (const f of data.features) {
          const geom = f.geometry;
          if (!geom) continue;
          const rings = geom.type === 'MultiPolygon'
            ? geom.coordinates.flat(1)
            : geom.type === 'Polygon' ? geom.coordinates : [];
          for (const ring of rings) {
            for (const coord of ring) {
              bounds.extend([coord[0], coord[1]]);
              extended = true;
            }
          }
        }
        if (extended) map.fitBounds(bounds, { padding: 80, maxZoom: 11, duration: 900 });
      }
    } catch (e: unknown) {
      setTestIsoDebug(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestIsoLoading(false);
    }
  };

  return {
    // Voronoï
    voronoiVisible, setVoronoiVisible,
    voronoiCategory,
    voronoiCirfas,
    // Bataille
    battleVisible, setBattleVisible,
    battleCategory,
    battleCirfas,
    // Test ORS
    testIsoVisible,
    testIsoLoading,
    testIsoDebug,
    // Isochrones
    isochroneVisible, setIsochroneVisible,
    isochroneMode,
    isochroneMinutes,
    isochroneFromCache, setIsochroneFromCache,
    isochroneCachedAt,
    lastIsochroneDataRef,
    // Carreaux
    carreauxVisible, setCarreauxVisible,
    carreauxLoaded,
    carreauxIndicateur,
    carreauxLabel,
    carreauxSources,
    carreauxSourcesRef,
    // Visualization functions
    applyVoronoi,
    applyIsochroneBattle,
    applyIsochrones,
    loadCarreauxFromAI,
    runTestIsochrone,
  };
}
