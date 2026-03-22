'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import {
  ISOCHRONE_COLORS,
  VORONOI_PALETTE,
  BATTLE_PALIER_OPACITY,
} from '../_lib/constants';
import { CARREAUX_PALETTES } from '@/components/CarreauxPMTilesLayer';
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
  const [voronoiPois,   setVoronoiPois]   = useState<{ id: string; nom: string; color: string }[]>([]);

  // Bataille d'Isochrones
  const [battleVisible,          setBattleVisible]          = useState(false);
  const [battleCategory,         setBattleCategory]         = useState('');
  const [battlePois,           setBattlePois]           = useState<{ id: string; nom: string; color: string }[]>([]);
  const [battleOuterFillVisible, setBattleOuterFillVisible] = useState(false);
  const [battleMaxPalier,        setBattleMaxPalier]        = useState(90);

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

  // Carreaux — visibility state only; MVT layers managed by useMapInit
  const [carreauxVisible,        setCarreauxVisible]        = useState(false);
  const [carreauxLoaded,         setCarreauxLoaded]         = useState(true);
  const [carreauxIndicateur,     setCarreauxIndicateur]     = useState('population_totale');
  const [carreauxLabel,          setCarreauxLabel]          = useState('Population totale');
  const [carreauxPalette,        _setCarreauxPalette]       = useState('rouge');
  const [carreauxOpacity,        _setCarreauxOpacity]       = useState(0.72);
  const [carreauxRange,          setCarreauxRange]          = useState<{ p5: number; p95: number } | null>(null);
  const [carreauxSelectedBucket, _setCarreauxSelectedBucket] = useState<number | null>(null);
  const carreauxSourcesRef = useRef<{ tableName: string; name: string }[]>([]);
  // Refs to always have current values without stale closures
  const carreauxIndicateurRef = useRef('population_totale');
  // Range mémorisé pour réappliquer la palette sans re-query (déclaré ici pour usage dans les effects)
  const carreauxRangeRef = useRef<{ ind: string; p5: number; p95: number } | null>(null);
  // Opacity ref — mir ror de _setCarreauxOpacity, accessible sans stale closure
  const carreauxOpacityRef = useRef(0.72);
  // Bucket info ref — pour que setCarreauxOpacity puisse réappliquer le bon filtre
  const carreauxBucketInfoRef = useRef<{ bucket: number; min: number; max: number; ind: string } | null>(null);

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

  // Filtre outer fill (palier=0) selon battleOuterFillVisible
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const baseFilter = ['!=', ['get', 'feature_type'], 'border'];
    const outerFilter = battleOuterFillVisible
      ? baseFilter
      : ['all', baseFilter, ['!=', ['get', 'palier'], 0]];
    try {
      map.setFilter('battle-fill',      outerFilter as any);
      map.setFilter('battle-ring-line', outerFilter as any);
    } catch { /* layer pas encore prêt */ }
  }, [battleOuterFillVisible, mapReady, mapRef]);

  // Filtre palier max — cache les anneaux au-delà du palier sélectionné
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const filter = ['all',
      ['!=', ['get', 'feature_type'], 'border'],
      ['any',
        ['==', ['get', 'palier'], 0],  // outer fill toujours inclus
        ['<=', ['get', 'palier'], battleMaxPalier],
      ],
    ];
    try {
      map.setFilter('battle-fill',      filter as any);
      map.setFilter('battle-ring-line', filter as any);
    } catch { /* layer pas encore prêt */ }
  }, [battleMaxPalier, mapReady, mapRef]);

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

  // Keep indicateur ref in sync with state + reset bucket/range/fill-color on change
  useEffect(() => {
    carreauxIndicateurRef.current = carreauxIndicateur;
    _setCarreauxSelectedBucket(null);
    setCarreauxRange(null);
    carreauxRangeRef.current = null;
    const map = mapRef.current;
    if (map) {
      try {
        // Restaurer l'opacité statique (plus de setFilter — voir applyBucketOpacity)
        map.setPaintProperty('carreaux-mvt-fill', 'fill-opacity', carreauxOpacityRef.current);
        map.setPaintProperty('carreaux-mvt-line', 'line-opacity', 0.35);
        map.setPaintProperty('carreaux-mvt-fill', 'fill-color', '#FC9272');
      } catch { /* ok */ }
    }
  }, [carreauxIndicateur, mapRef]);

  // ── Carreaux MVT — visibilité ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = carreauxVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('carreaux-mvt-fill', 'visibility', vis);
      map.setLayoutProperty('carreaux-mvt-line', 'visibility', vis);
    } catch { /* ok */ }
  }, [carreauxVisible, mapReady, mapRef]);

  // Applique fill-color avec les stops + range stocké
  const applyCarreauxColor = useCallback((
    map: maplibregl.Map,
    paletteId: string,
    ind: string,
    p5: number,
    p95: number,
  ) => {
    if (!map.getLayer('carreaux-mvt-fill')) return;
    const pal = CARREAUX_PALETTES.find(p => p.id === paletteId) ?? CARREAUX_PALETTES[0];
    const range = p95 - p5;
    if (range <= 0) return;
    // safeNum : null-safe — to-number with fallback 0 ensures static return type = number
    // so interpolate doesn't get a Value/unknown from ['get', ind]
    const safeNum = ['to-number', ['get', ind], 0];
    const positions = [0, 0.20, 0.40, 0.60, 0.80, 1.00];
    const expr = ['interpolate', ['linear'],
      safeNum,
      ...positions.flatMap((t, i) => [p5 + t * range, pal.stops[i]]),
    ] as unknown as maplibregl.ExpressionSpecification;
    try { map.setPaintProperty('carreaux-mvt-fill', 'fill-color', expr); } catch { /* ok */ }
  }, []);

  // ── Setters directs — applique immédiatement sans passer par les effects ──

  const setCarreauxPalette = useCallback((paletteId: string) => {
    console.log('[palette] click', paletteId, 'map:', !!mapRef.current);
    _setCarreauxPalette(paletteId);
    const map = mapRef.current;
    if (!map) { console.warn('[palette] no map'); return; }
    const ind = carreauxIndicateurRef.current;
    const r = carreauxRangeRef.current;
    console.log('[palette] range:', r, 'ind:', ind, 'layer exists:', !!map.getLayer('carreaux-mvt-fill'));
    if (r && r.p95 > r.p5) {
      applyCarreauxColor(map, paletteId, r.ind, r.p5, r.p95);
      console.log('[palette] applied from cache');
    } else {
      if (!map.getLayer('carreaux-mvt-fill')) { console.warn('[palette] layer not found'); return; }
      const feats = map.queryRenderedFeatures(undefined, { layers: ['carreaux-mvt-fill'] });
      console.log('[palette] queried features:', feats.length);
      const values = feats
        .map(f => Number((f.properties as Record<string, unknown>)?.[ind] ?? 0))
        .filter(v => v > 0);
      if (values.length === 0) { console.warn('[palette] no values for ind:', ind); return; }
      const sorted = [...values].sort((a, b) => a - b);
      const p5  = sorted[Math.floor(sorted.length * 0.05)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      if (p95 > p5) {
        carreauxRangeRef.current = { ind, p5, p95 };
        setCarreauxRange({ p5, p95 });
        applyCarreauxColor(map, paletteId, ind, p5, p95);
        console.log('[palette] applied from query, p5:', p5, 'p95:', p95);
      }
    }
  }, [mapRef, applyCarreauxColor]);

  // ── Helper : applique l'opacité bucket via setPaintProperty (pas setFilter) ──
  // Raison : setFilter s'exécute dans le worker MapLibre (_parseWorkerTile) avec
  // un type checker strict qui rejette Value → "Expected number, found null" → tuile droppée.
  // setPaintProperty s'évalue au render time dans le thread principal → pas de crash.
  const applyBucketOpacity = useCallback((
    map: maplibregl.Map,
    info: { bucket: number; min: number; max: number; ind: string } | null,
    opacity: number,
  ) => {
    if (!map.getLayer('carreaux-mvt-fill')) return;
    if (!info) {
      try {
        map.setPaintProperty('carreaux-mvt-fill', 'fill-opacity', opacity);
        map.setPaintProperty('carreaux-mvt-line', 'line-opacity', 0.35);
      } catch { /* ok */ }
      return;
    }
    const { bucket, min, max, ind } = info;
    const val = ['to-number', ['get', ind], 0] as unknown as maplibregl.ExpressionSpecification;
    const inBucket = (bucket === 5
      ? ['>=', val, min]
      : ['all', ['>=', val, min], ['<', val, max]]
    ) as unknown as maplibregl.ExpressionSpecification;
    try {
      map.setPaintProperty('carreaux-mvt-fill', 'fill-opacity',
        ['case', inBucket, opacity, 0] as unknown as maplibregl.ExpressionSpecification);
      map.setPaintProperty('carreaux-mvt-line', 'line-opacity',
        ['case', inBucket, 0.35, 0] as unknown as maplibregl.ExpressionSpecification);
    } catch { /* ok */ }
  }, []);

  const setCarreauxOpacity = useCallback((v: number) => {
    carreauxOpacityRef.current = v;
    _setCarreauxOpacity(v);
    const map = mapRef.current;
    if (!map) return;
    applyBucketOpacity(map, carreauxBucketInfoRef.current, v);
  }, [mapRef, applyBucketOpacity]);

  // Sélection d'une tranche de la légende → fill-opacity expression (PAS setFilter)
  const setCarreauxSelectedBucket = useCallback((bucket: number | null) => {
    _setCarreauxSelectedBucket(bucket);
    const map = mapRef.current;
    if (!map) return;
    if (bucket === null) {
      carreauxBucketInfoRef.current = null;
      applyBucketOpacity(map, null, carreauxOpacityRef.current);
      return;
    }
    const r = carreauxRangeRef.current;
    if (!r) {
      carreauxBucketInfoRef.current = null;
      applyBucketOpacity(map, null, carreauxOpacityRef.current);
      return;
    }
    const ind = carreauxIndicateurRef.current;
    const step = (r.p95 - r.p5) / 6;
    const min = r.p5 + bucket * step;
    const max = r.p5 + (bucket + 1) * step;
    const info = { bucket, min, max, ind };
    carreauxBucketInfoRef.current = info;
    applyBucketOpacity(map, info, carreauxOpacityRef.current);
  }, [mapRef, applyBucketOpacity]);

  // ── Recoloration dynamique (pan + indicateur) ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !carreauxVisible) return;

    let debounce: ReturnType<typeof setTimeout> | null = null;

    const recolor = () => {
      if (!map.getLayer('carreaux-mvt-fill')) return;
      const features = map.queryRenderedFeatures(undefined, { layers: ['carreaux-mvt-fill'] });
      if (features.length === 0) return;
      const values = features
        .map(f => Number((f.properties as Record<string, unknown>)?.[carreauxIndicateur] ?? 0))
        .filter(v => v > 0);
      if (values.length === 0) return;
      const sorted = [...values].sort((a, b) => a - b);
      const p5  = sorted[Math.floor(sorted.length * 0.05)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      if (p95 <= p5) return;
      // Mémorise le range pour la palette + état React pour la légende
      carreauxRangeRef.current = { ind: carreauxIndicateur, p5, p95 };
      setCarreauxRange({ p5, p95 });
      applyCarreauxColor(map, carreauxPalette, carreauxIndicateur, p5, p95);
    };

    const scheduleRecolor = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(recolor, 150);
    };

    map.on('idle',    scheduleRecolor);
    map.on('moveend', scheduleRecolor);
    scheduleRecolor();

    return () => {
      map.off('idle',    scheduleRecolor);
      map.off('moveend', scheduleRecolor);
      if (debounce) clearTimeout(debounce);
    };
  }, [carreauxIndicateur, carreauxPalette, carreauxVisible, mapReady, mapRef, applyCarreauxColor]);

  // ── Visualization functions ───────────────────────────────────────────────

  const applyVoronoi = (vData: VoronoiData) => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    voronoiDataForSaveRef.current = vData;
    const meta = vData._meta;
    const geo  = meta?.filtre_region ?? meta?.filtre_ville ?? meta?.filtre_dept ?? '';
    setSaveName(`Voronoï ${meta?.category ?? ''} ${geo}`.trim().replace(/\s+/g, ' '));

    const poiColorMap = new Map<string, string>();
    let _colorIdx = 0;
    for (const f of vData.features) {
      const cid = String((f.properties as Record<string, unknown>)?.id ?? '');
      if (cid && !poiColorMap.has(cid)) {
        poiColorMap.set(cid, VORONOI_PALETTE[_colorIdx % VORONOI_PALETTE.length]);
        _colorIdx++;
      }
    }

    const featuresWithColors = vData.features.map((f) => {
      const cid = String((f.properties as Record<string, unknown>)?.id ?? '');
      const voronoi_color = poiColorMap.get(cid) ?? VORONOI_PALETTE[0];
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

    const _poiSeen = new Set<string>();
    const poiLegend: { id: string; nom: string; color: string }[] = [];
    for (const f of featuresWithColors) {
      const p = f.properties as Record<string, unknown>;
      const cid = String(p?.id ?? '');
      if (cid && !_poiSeen.has(cid)) {
        _poiSeen.add(cid);
        poiLegend.push({ id: cid, nom: String(p?.nom ?? cid), color: poiColorMap.get(cid) ?? VORONOI_PALETTE[0] });
      }
    }
    setVoronoiPois(poiLegend);

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

  // Référence interne pour accumuler les anneaux partiels côté client
  const partialRingsRef = useRef<GeoJSON.Feature[]>([]);

  /**
   * Réinitialise les anneaux partiels — à appeler au début de chaque nouvelle bataille.
   */
  const clearBattlePartialRings = () => {
    partialRingsRef.current = [];
    const map = mapRef.current;
    if (!map) return;
    const ringSrc = map.getSource('battle-rings') as maplibregl.GeoJSONSource | undefined;
    if (ringSrc) ringSrc.setData({ type: 'FeatureCollection', features: [] });
  };

  /**
   * Ajoute des anneaux bruts ORS sur la carte dès qu'ils arrivent (avant ST_Difference).
   * Ces polygones se chevauchent — ils sont remplacés par le résultat final de applyIsochroneBattle.
   */
  const addBattlePartialRings = (
    rawRings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: object }[]
  ) => {
    const map = mapRef.current;
    if (!map) return;

    // Reconstruire la map poi_id → couleur depuis les rings déjà accumulés
    const poiColorMap = new Map<string, string>();
    let colorIdx = 0;
    for (const f of partialRingsRef.current) {
      const cid = String(f.properties?.cirfa_id ?? f.properties?.id ?? '');
      if (cid && !poiColorMap.has(cid)) {
        poiColorMap.set(cid, VORONOI_PALETTE[colorIdx % VORONOI_PALETTE.length]);
        colorIdx++;
      }
    }

    for (const r of rawRings) {
      const cid = r.cirfa_id;
      if (!poiColorMap.has(cid)) {
        poiColorMap.set(cid, VORONOI_PALETTE[colorIdx % VORONOI_PALETTE.length]);
        colorIdx++;
      }

      const feat: GeoJSON.Feature = {
        type:       'Feature',
        geometry:   r.geojson as GeoJSON.Geometry,
        properties: {
          id:             cid,
          cirfa_id:       cid,
          nom:            r.nom,
          lat:            r.lat,
          lng:            r.lng,
          palier:         r.palier,
          battle_color:   poiColorMap.get(cid)!,
          battle_opacity: (BATTLE_PALIER_OPACITY as Record<number, number>)[r.palier] ?? 0.15,
          _partial:       true,
        },
      };
      partialRingsRef.current.push(feat);
    }

    const ringSrc = map.getSource('battle-rings') as maplibregl.GeoJSONSource | undefined;
    if (ringSrc) {
      ringSrc.setData({ type: 'FeatureCollection', features: partialRingsRef.current } as GeoJSON.FeatureCollection);
      try {
        map.setLayoutProperty('battle-fill',      'visibility', 'visible');
        map.setLayoutProperty('battle-ring-line', 'visibility', 'visible');
      } catch { /* layer pas encore prêt */ }
      setBattleVisible(true);
    }
  };

  const applyIsochroneBattle = (
    ringData:   { type: string; features: GeoJSON.Feature[] },
    borderData: { type: string; features: GeoJSON.Feature[] } | null | undefined,
    category?:  string,
    poisForMap?: { id: string; nom: string; lat: number; lng: number; adresse?: string; ville?: string }[]
  ) => {
    const map = mapRef.current;
    console.log('[applyIsochroneBattle] called — map:', !!map, '| features:', ringData?.features?.length);
    if (!map) return;

    const poiColorMap = new Map<string, string>();
    let _colorIdx = 0;
    for (const f of ringData.features) {
      const p   = f.properties as Record<string, unknown>;
      // Support: 'id' (v2) ou 'cirfa_id' (v1 éventuelle)
      const cid = String(p?.id ?? p?.cirfa_id ?? '');
      if (cid && !poiColorMap.has(cid)) {
        poiColorMap.set(cid, VORONOI_PALETTE[_colorIdx % VORONOI_PALETTE.length]);
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
          battle_color:   poiColorMap.get(cid) ?? VORONOI_PALETTE[0],
          battle_opacity: (BATTLE_PALIER_OPACITY as Record<number, number>)[palier] ?? 0.20,
        },
      };
    });

    // Vider les anneaux partiels — le résultat final les remplace
    partialRingsRef.current = [];

    const ringSrc = map.getSource('battle-rings') as maplibregl.GeoJSONSource | undefined;
    console.log('[applyIsochroneBattle] ringSrc:', !!ringSrc, '| styledRings:', styledRings.length);
    if (!ringSrc) return;
    ringSrc.setData({ type: 'FeatureCollection', features: styledRings } as GeoJSON.FeatureCollection);
    map.triggerRepaint();

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

    // Utiliser poisForMap (tous les POIs) si disponible,
    // sinon extraire des ring features (peut rater des POIs sans territoire).
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
        legend.push({ id: cid, nom: String(p?.nom ?? cid), color: poiColorMap.get(cid) ?? VORONOI_PALETTE[0] });
      }
    }
    setBattlePois(legend);

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
      if (extended) {
        console.log('[applyIsochroneBattle] fitBounds called');
        map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 1200 });
      }
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
    const map = mapRef.current;
    if (!map) return;

    const { lat, lng } = cd.coordonnees;
    // Fly to z12 pour vue détaillée 200m (carreaux visibles dès z6)
    map.flyTo({ center: [lng, lat], zoom: 12, duration: 1000 });

    setCarreauxVisible(true);
    setCarreauxIndicateur(cd.indicateur);
    setCarreauxLabel(cd.indicateur_label);
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
    voronoiPois,
    // Bataille
    battleVisible, setBattleVisible,
    battleCategory,
    battlePois,
    battleOuterFillVisible, setBattleOuterFillVisible,
    battleMaxPalier, setBattleMaxPalier,
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
    carreauxIndicateur, setCarreauxIndicateur,
    carreauxPalette,    setCarreauxPalette,
    carreauxOpacity,    setCarreauxOpacity,
    carreauxRange,
    carreauxSelectedBucket, setCarreauxSelectedBucket,
    carreauxLabel,
    carreauxSourcesRef,
    // Visualization functions
    applyVoronoi,
    clearBattlePartialRings,
    addBattlePartialRings,
    applyIsochroneBattle,
    applyIsochrones,
    loadCarreauxFromAI,
    runTestIsochrone,
  };
}
