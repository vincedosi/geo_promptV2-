'use client';

/**
 * MAGELIAN — couche Radio FM/DAB+ de la carte.
 *
 * Regroupe les 16 etats, 1 ref d'annulation et 4 effets qui pilotaient les
 * emetteurs radio depuis app/map/page.tsx (refactor du 31/08/2026) :
 * chargement des emetteurs, options de filtre, synchronisation des couches
 * MapLibre (clusters / heatmap / points / couverture) et generation des
 * cercles de couverture cote client.
 *
 * ⛔ A appeler APRES useMapInit : le hook a besoin de `mapRef` et `mapReady`.
 *
 * Trois strategies de chargement coexistent volontairement, et il ne faut
 * pas les uniformiser :
 *   - une radio precise selectionnee  -> tous ses emetteurs, sans bbox
 *   - mode couverture                 -> fetch global (limit 15000), sans bbox,
 *     sinon un emetteur dont le centre sort du viewport perdrait son cercle
 *     alors que sa couverture (jusqu'a 54 km) intersecte encore l'ecran
 *   - mode clusters / heatmap         -> bbox du viewport, recharge au moveend
 *     avec debounce 600 ms et garde sur la bbox arrondie
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';

export interface RadioFilterOptions {
  radios: Array<{ id: string; nom: string; cat: string | null }>;
  categories: Array<{ value: string; label: string }>;
}

export function useRadioLayer(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapReady: boolean,
) {
  const [radioVisible,       setRadioVisible]       = useState(false);
  const [radioHeatmapMode,   setRadioHeatmapMode]   = useState(false);
  const [radioCoverageMode,  setRadioCoverageMode]  = useState(false);
  const [radioGeoJSON,       setRadioGeoJSON]       = useState<GeoJSON.FeatureCollection | null>(null);

  // Filtres multi-radios (dropdown searchable) + exclusions catégories
  const [radioFilterIds,         setRadioFilterIds]         = useState<string[]>([]);
  const [radioExcludeCategories, setRadioExcludeCategories] = useState<string[]>([]);
  const [radioFilterOptions,     setRadioFilterOptions]     = useState<RadioFilterOptions | null>(null);

  const [radioLoading,       setRadioLoading]       = useState(false);
  const [radioSystemeFilter, setRadioSystemeFilter] = useState('');
  const [radioSelectedId,    setRadioSelectedId]    = useState<string | null>(null);
  const [radioSelectedNom,   setRadioSelectedNom]   = useState<string | null>(null);
  const [radioCoverageColor, setRadioCoverageColor] = useState('#4ecdc4');
  const [radioCoverageOpacity, setRadioCoverageOpacity] = useState(15);
  const [radioBorderWidth,   setRadioBorderWidth]   = useState(0.5);
  const [radioPointSize,     setRadioPointSize]     = useState(5);

  const radioFetchRef = useRef<AbortController | null>(null);

  // ── Options de filtre — fetch lazy (au 1er toggle radio) ───────────────────
  // L'API renvoie {categories, groupes, radios_with_emetteurs} ; on transforme
  // au shape attendu par FilterPanel : {categories, radios}.
  useEffect(() => {
    if (!radioVisible || radioFilterOptions) return;
    let aborted = false;
    adminFetch('/api/radio/filter-options')
      .then(r => r.ok ? r.json() : null)
      .then((data: { categories?: Array<{ value: string; label: string }>; radios_with_emetteurs?: Array<{ id: string; nom: string; cat: string | null }> } | null) => {
        if (aborted || !data) return;
        setRadioFilterOptions({
          categories: Array.isArray(data.categories) ? data.categories : [],
          radios:     Array.isArray(data.radios_with_emetteurs) ? data.radios_with_emetteurs : [],
        });
      })
      .catch(() => {});
    return () => { aborted = true; };
  }, [radioVisible, radioFilterOptions]);

  // ── Emetteurs — fetch ──────────────────────────────────────────────────────
  const handleLoadRadio = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    setRadioLoading(true);
    radioFetchRef.current?.abort();
    const ctrl = new AbortController();
    radioFetchRef.current = ctrl;
    try {
      const params = new URLSearchParams();
      if (radioSelectedId) {
        // Une radio précise sélectionnée → tous ses émetteurs (sans bbox)
        params.set('radio_id', radioSelectedId);
      } else if (radioCoverageMode) {
        // Mode couverture (cercles) → fetch GLOBAL sans bbox.
        // Sinon les cercles disparaissent au zoom in : un émetteur dont le
        // centre sort du viewport perd son cercle alors que sa couverture
        // (rayon jusqu'à 54km) intersecte encore la zone visible.
        // 11k émetteurs ≈ 3-5MB GeoJSON, MapLibre gère sans souci.
        params.set('limit', '15000');
      } else {
        // Mode clusters/heatmap → fetch viewport bbox (rapide, dynamique)
        const b = map.getBounds();
        params.set('bbox', `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b.getNorth().toFixed(4)}`);
      }
      if (radioSystemeFilter) params.set('systeme', radioSystemeFilter);
      // Multi-radios filter (dropdown searchable) + exclusions catégories
      if (radioFilterIds.length > 0)         params.set('radio_ids', radioFilterIds.join(','));
      if (radioExcludeCategories.length > 0) params.set('exclude_categories', radioExcludeCategories.join(','));
      const res = await adminFetch(`/api/radio/emetteurs?${params}`, { signal: ctrl.signal });
      if (!res.ok) return;
      const data: GeoJSON.FeatureCollection = await res.json();
      setRadioGeoJSON(data);

      // FitBounds if specific radio selected
      if (radioSelectedId && data.features.length > 0) {
        let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
        for (const f of data.features) {
          if (f.geometry?.type === 'Point') {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        }
        if (minLng < maxLng) {
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, duration: 1000 });
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') console.error('[radio]', e);
    } finally {
      setRadioLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, radioSystemeFilter, radioSelectedId, radioFilterIds, radioExcludeCategories, radioCoverageMode]);

  // ── Sync GeoJSON → source + visibilite et peinture des couches ─────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const showClusters = radioVisible && !radioHeatmapMode;
    const showHeatmap  = radioVisible && radioHeatmapMode;
    const showPoints   = radioVisible && !radioHeatmapMode;

    // Update source data
    if (radioGeoJSON) {
      const src = map.getSource('radio-emetteurs') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(radioGeoJSON);
    }

    // Toggle layer visibility
    try { map.setLayoutProperty('radio-clusters', 'visibility', showClusters ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('radio-cluster-count', 'visibility', showClusters ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('radio-points', 'visibility', showPoints ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('radio-heatmap', 'visibility', showHeatmap ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('radio-coverage-fill', 'visibility', radioCoverageMode && radioVisible ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('radio-coverage-line', 'visibility', radioCoverageMode && radioVisible ? 'visible' : 'none'); } catch { /* */ }

    // Sync paint properties for controls
    try { map.setPaintProperty('radio-coverage-fill', 'fill-color', radioCoverageColor); } catch { /* */ }
    try { map.setPaintProperty('radio-coverage-fill', 'fill-opacity', radioCoverageOpacity / 100); } catch { /* */ }
    try { map.setPaintProperty('radio-coverage-line', 'line-color', radioCoverageColor); } catch { /* */ }
    try { map.setPaintProperty('radio-coverage-line', 'line-opacity', Math.min(radioCoverageOpacity / 100 + 0.2, 1)); } catch { /* */ }
    try { map.setPaintProperty('radio-coverage-line', 'line-width', radioBorderWidth); } catch { /* */ }

    // Point size + highlight mode
    if (radioSelectedId) {
      try {
        map.setPaintProperty('radio-points', 'circle-color', [
          'case', ['==', ['get', 'radio_id'], radioSelectedId], 'var(--brand-teal)', '#4b5563',
        ] as unknown as maplibregl.ExpressionSpecification);
        map.setPaintProperty('radio-points', 'circle-opacity', [
          'case', ['==', ['get', 'radio_id'], radioSelectedId], 1, 0.35,
        ] as unknown as maplibregl.ExpressionSpecification);
        map.setPaintProperty('radio-points', 'circle-radius', radioPointSize);
      } catch { /* */ }
    } else {
      try {
        map.setPaintProperty('radio-points', 'circle-color', [
          'match', ['get', 'portee'],
          'nationale', '#3b82f6', 'locale', '#22c55e', 'autoroute', '#eab308', '#6b7280',
        ] as unknown as maplibregl.ExpressionSpecification);
        map.setPaintProperty('radio-points', 'circle-opacity', 0.9);
        map.setPaintProperty('radio-points', 'circle-radius', radioPointSize);
      } catch { /* */ }
    }
  }, [radioGeoJSON, radioVisible, radioHeatmapMode, radioCoverageMode, mapReady, radioCoverageColor, radioCoverageOpacity, radioBorderWidth, radioPointSize, radioSelectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Declenchement du chargement + recharge au moveend ──────────────────────
  const lastRadioBboxRef = useRef('');
  useEffect(() => {
    if (!radioVisible || !mapReady) return;
    handleLoadRadio();

    // Une radio précise OU mode couverture global → load once, pas de re-fetch
    // sur moveend (sinon la couverture clignote au zoom).
    if (radioSelectedId || radioCoverageMode) return;

    // Mode clusters/heatmap : reload on moveend avec debounce + check bbox
    const map = mapRef.current;
    if (!map) return;
    let timer: ReturnType<typeof setTimeout>;
    const debouncedMove = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const b = map.getBounds();
        const newBbox = `${b.getWest().toFixed(2)},${b.getSouth().toFixed(2)},${b.getEast().toFixed(2)},${b.getNorth().toFixed(2)}`;
        if (newBbox === lastRadioBboxRef.current) return; // bbox hasn't changed significantly
        lastRadioBboxRef.current = newBbox;
        handleLoadRadio();
      }, 600);
    };
    map.on('moveend', debouncedMove);
    return () => { map.off('moveend', debouncedMove); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radioVisible, mapReady, radioSelectedId, radioCoverageMode, handleLoadRadio]);

  // ── Cercles de couverture generes cote client ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !radioCoverageMode || !radioGeoJSON) return;
    const src = map.getSource('radio-coverage') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    // Generate circles (limit to 500)
    const features = radioGeoJSON.features.slice(0, 500);
    const circles: GeoJSON.Feature[] = [];
    for (const f of features) {
      if (f.geometry.type !== 'Point') continue;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      const radius = Number((f.properties as Record<string, unknown>)?.rayon_couverture_m ?? 0);
      if (!radius || radius < 100) continue;
      // Simple circle approximation (64 segments)
      const coords: [number, number][] = [];
      for (let i = 0; i <= 64; i++) {
        const angle = (i / 64) * 2 * Math.PI;
        const dlat = (radius / 111320) * Math.cos(angle);
        const dlng = (radius / (111320 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);
        coords.push([lng + dlng, lat + dlat]);
      }
      circles.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { color: 'var(--brand-teal)' },
      });
    }
    src.setData({ type: 'FeatureCollection', features: circles });
  }, [radioGeoJSON, radioCoverageMode, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    radioVisible, setRadioVisible,
    radioHeatmapMode, setRadioHeatmapMode,
    radioCoverageMode, setRadioCoverageMode,
    radioGeoJSON,
    radioFilterIds, setRadioFilterIds,
    radioExcludeCategories, setRadioExcludeCategories,
    radioFilterOptions,
    radioLoading,
    radioSystemeFilter, setRadioSystemeFilter,
    radioSelectedId, setRadioSelectedId,
    radioSelectedNom, setRadioSelectedNom,
    radioCoverageColor, setRadioCoverageColor,
    radioCoverageOpacity, setRadioCoverageOpacity,
    radioBorderWidth, setRadioBorderWidth,
    radioPointSize, setRadioPointSize,
  };
}
