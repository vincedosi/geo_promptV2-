'use client';

import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { circleGeoJSON, getCatColor, MAP_STYLES, MAP_STYLE } from '@/app/copilote/_lib/constants';
import { useMapInit }          from '@/app/copilote/_hooks/useMapInit';
import { useSavedMaps }        from '@/app/copilote/_hooks/useSavedMaps';
import { useMapLayers }        from '@/app/copilote/_hooks/useMapLayers';
import { useChatControls }     from '@/app/copilote/_hooks/useChatControls';
import { useRateLimitHandler } from '@/app/copilote/_hooks/useRateLimitHandler';
import { useToolProcessor }    from '@/app/copilote/_hooks/useToolProcessor';
import { useProviderSelector } from '@/app/copilote/_hooks/useProviderSelector';
import { MapPanel }            from '@/app/copilote/_components/MapPanel';
import { FilterPanel }         from '@/app/map/_components/FilterPanel';
import type { DirectPOISearchParams, DirectBattleParams, DirectBattleV2Params } from '@/app/map/_components/FilterPanel';
import type { ZoneData }       from '@/types/spatial';
import { exportOohReport, type OohExportData } from '@/app/copilote/_lib/ooh-export';
import { CoverageResultsPanel, type CoverageSummaryEntry } from '@/components/CoverageResultsPanel';
import type { POI } from '@/types/poi';

interface SelectedBillboard {
  id: string; nom: string; lat: number; lng: number;
  format?: string; score?: number | null; audience?: number | null;
  rank?: number | null; regie?: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MapPage() {
  const [error,    setError]    = useState<string | null>(null);
  const [zoneData, setZoneData] = useState<ZoneData | null>(null);
  const [selectedBillboard, setSelectedBillboard] = useState<SelectedBillboard | null>(null);
  const [mapStyleUrl, setMapStyleUrl] = useState<string>(MAP_STYLE);
  const [battleFeatures,      setBattleFeatures]      = useState<GeoJSON.Feature[]>([]);
  const [battlePois,          setBattlePois]          = useState<POI[]>([]);
  const [isResultsPanelOpen,  setIsResultsPanelOpen]  = useState(false);
  const [coverageSummary,     setCoverageSummary]     = useState<CoverageSummaryEntry[]>([]);
  const [battleCacheKey,      setBattleCacheKey]      = useState<string | null>(null);
  useEffect(() => {
    const stored = localStorage.getItem('genesis_map_style');
    if (stored) setMapStyleUrl(stored);
  }, []);

  const handleMapStyleChange = (url: string) => {
    setMapStyleUrl(url);
    localStorage.setItem('genesis_map_style', url);
  };

  // Stocke le résultat de bataille pré-calculé (PostGIS) — appliqué uniquement sur clic "BATAILLE"
  const pendingBattleRef = useRef<{ geoJSON: any; borders: any; category?: string; poisForMap?: any[] } | null>(null);

  const { mapContainerRef, mapRef, markersRef, mapReady } = useMapInit(zoneData, setSelectedBillboard, mapStyleUrl);
  const savedMaps = useSavedMaps({ zoneData, setZoneData });
  const mapLayers = useMapLayers({
    mapRef, mapReady,
    isochroneDataForSaveRef:  savedMaps.isochroneDataForSaveRef,
    carreauxConfigForSaveRef: savedMaps.carreauxConfigForSaveRef,
    voronoiDataForSaveRef:    savedMaps.voronoiDataForSaveRef,
    setSaveName:              savedMaps.setSaveName,
  });
  const providerSelector = useProviderSelector();
  const chat = useChatControls({
    setError,
    setZoneData,
    setIsochroneFromCache: mapLayers.setIsochroneFromCache,
    provider: providerSelector.provider,
  });
  useRateLimitHandler({
    chatError:          chat.chatError,
    setError,
    sendChatMessage:    chat.sendChatMessage,
    lastUserMessageRef: chat.lastUserMessageRef,
  });
  useToolProcessor({
    messages:                chat.messages,
    setZoneData,
    setError,
    applyIsochrones:          mapLayers.applyIsochrones,
    applyVoronoi:             mapLayers.applyVoronoi,
    applyIsochroneBattle:     mapLayers.applyIsochroneBattle,
    loadCarreauxFromAI:       mapLayers.loadCarreauxFromAI,
    carreauxSourcesRef:       mapLayers.carreauxSourcesRef,
    carreauxConfigForSaveRef: savedMaps.carreauxConfigForSaveRef,
    flyToCoords: (lat, lng) => {
      if (mapRef.current && mapReady) mapRef.current.flyTo({ center: [lng, lat], zoom: 11, duration: 1200 });
    },
    triggerOohExport: async (data: OohExportData) => {
      setError('Generation du rapport Excel...');
      await exportOohReport(data, mapRef, msg => {
        if (msg) setError(msg);
        else setError(null);
      });
    },
  });

  savedMaps.applyIsochronesRef.current = mapLayers.applyIsochrones;
  savedMaps.applyVoronoiRef.current    = mapLayers.applyVoronoi;
  savedMaps.loadCarreauxRef.current    = mapLayers.loadCarreauxFromAI;
  savedMaps.setMessagesRef.current     = chat.setMessages;

  // ── Markers + flyTo ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !zoneData || !zoneData.coordonnees) return;
    const { lat, lng } = zoneData.coordonnees;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const MAX_DOM = 300;
    const useLayers = zoneData.pois.length > MAX_DOM;

    const heatSrc = map.getSource('pois-heat') as maplibregl.GeoJSONSource | undefined;
    if (heatSrc) {
      heatSrc.setData({
        type: 'FeatureCollection',
        features: zoneData.pois.map(p => {
          const color = zoneData.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
            properties: { id: p.id, categorie: p.categorie, nom: p.nom ?? '', color, lat: p.lat, lng: p.lng },
          };
        }),
      });
    }
    try { map.setLayoutProperty('pois-circles', 'visibility', useLayers ? 'visible' : 'none'); } catch { /* */ }

    (map.getSource('zone-circle') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: zoneData.rayon_metres ? [circleGeoJSON(lng, lat, zoneData.rayon_metres)] : [],
    });
    map.triggerRepaint();

    if (!useLayers) {
      zoneData.pois.forEach(p => {
        const color = zoneData.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
        const rankVal = (p as any).rank;
        const el = document.createElement('div');
        if (rankVal) {
          el.style.cssText = `width:22px;height:22px;background:${color};border:2px solid rgba(255,255,255,0.95);border-radius:50%;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;font-family:system-ui,sans-serif`;
          el.textContent = String(rankVal);
        } else {
          el.style.cssText = `width:10px;height:10px;background:${color};border:2px solid rgba(255,255,255,0.9);border-radius:50%;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4)`;
        }
        const nom = (p.nom || 'POI').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const audienceVal = (p as any).audience;
        const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
          `<div style="font-size:12px;padding:6px 8px">` +
          (rankVal ? `<span style="color:#f59e0b;font-weight:700;font-size:13px">#${rankVal}</span> ` : '') +
          `<strong>${nom}</strong><br/>` +
          `<span style="color:${color};font-size:11px;font-weight:600;text-transform:uppercase">${p.categorie}</span>` +
          (p.sous_categorie ? ` <span style="color:#94a3b8;font-size:11px">· ${p.sous_categorie}</span>` : '') +
          (audienceVal != null ? `<br/><span style="color:#10b981;font-size:12px;font-weight:600">+${Number(audienceVal).toLocaleString('fr-FR')} pers.</span>` : '') +
          (p.adresse ? `<br/><span style="color:#64748b;font-size:11px">${p.adresse}</span>` : '') +
          `</div>`
        );
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);

        if (p.categorie === 'panneaux' || p.categorie === 'top_ooh') {
          el.addEventListener('click', () => {
            setSelectedBillboard({ id: p.id, nom: p.nom ?? 'Panneau', lat: p.lat, lng: p.lng,
              format: p.sous_categorie ?? undefined, score: (p as any).score_ooh ?? null,
              audience: (p as any).audience ?? null, rank: (p as any).rank ?? null, regie: p.adresse ?? undefined });
          });
        }
      });
    }

    // Marqueur ville
    const cityEl = document.createElement('div');
    cityEl.style.cssText = 'width:10px;height:10px;background:#a855f7;border:2px solid #fff;border-radius:2px;box-shadow:0 0 8px rgba(168,85,247,0.8)';
    markersRef.current.push(new maplibregl.Marker({ element: cityEl, anchor: 'center' }).setLngLat([lng, lat]).addTo(map));

    if (zoneData.pois.length > 1) {
      const lats = zoneData.pois.map(p => p.lat);
      const lngs = zoneData.pois.map(p => p.lng);
      map.fitBounds(
        new maplibregl.LngLatBounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]),
        { padding: 40, maxZoom: useLayers ? 7 : 14, duration: 1200 }
      );
      return;
    }
    const r = zoneData.rayon_metres, rPoi = zoneData.rayon_poi_metres;
    let zoom = 12;
    if (rPoi) zoom = rPoi < 300 ? 15 : rPoi < 800 ? 14 : rPoi < 2000 ? 13 : 12;
    else if (r) zoom = r < 1500 ? 14 : r < 4000 ? 13 : 11;
    map.flyTo({ center: [lng, lat], zoom, duration: 1200 });
  }, [zoneData, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Note: no zoom-based opacity hiding on /map page — markers stay visible at all zoom levels.
  // (FilterPanel sends national queries that fitBounds to France zoom ~5-6, hiding markers at z<10)

  const handleDirectSearch = async (params: DirectPOISearchParams) => {
    setError(null);
    setZoneData(null);
    const res = await fetch('/api/map/pois', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (data.error) setError(data.error);
    else setZoneData(data);
  };

  const handleDirectBattle = async (
    params: DirectBattleParams,
    onProgress?: (msg: string, pct?: number) => void,
  ): Promise<{ geometry: string; nb_pois: number; poiGroups: { id: string; nom: string; geometries: string[] }[]; battleRings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: string }[] }> => {
    setError(null);
    pendingBattleRef.current = null;
    mapLayers.clearBattlePartialRings();
    console.log('[map] handleDirectBattle →', params);
    let data: any;
    try {
      const res = await fetch('/api/isochrone-battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:           params.category,
          mode:               params.mode,
          max_minutes:        params.max_minutes,
          durations:          params.durations,
          filtre_ville:       params.filtre_ville    ?? null,
          filtre_regions:     params.filtre_regions  ?? null,
          metropolitaine:     params.metropolitaine,
          force_recalculate:  params.force_recalculate ?? false,
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: any;
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === 'error') {
            const raw = String(evt.message ?? 'Erreur inconnue');
            throw new Error(raw.startsWith('<') ? 'Service temporairement indisponible (503/521)' : raw.slice(0, 200));
          }
          if (evt.type === 'result') { data = evt.data; continue; }
          if (evt.type === 'partial_rings' && evt.rings?.length > 0) {
            // Afficher les anneaux bruts dès qu'ils arrivent (avant ST_Difference)
            mapLayers.addBattlePartialRings(evt.rings);
            onProgress?.(`> ◆ +${evt.rings.length} isochrones sur la carte`);
          } else if (evt.type === 'pois_loaded') {
            onProgress?.(`> ${evt.total} POIs trouvés — démarrage ORS...`);
          } else if (evt.type === 'progress') {
            if (evt.status === 'bataille_postgis') {
              onProgress?.('> [BATAILLE] ST_Difference en cours (PostGIS)...');
            } else {
              const pct = Math.round((evt.completed / evt.total) * 100);
              const errInfo = evt.err > 0 ? ` (${evt.err} erreurs ORS)` : '';
              onProgress?.(`> ${evt.completed}/${evt.total} POIs traités — ${pct}%${errInfo}`);
            }
          }
        }
      }
      reader.releaseLock();
      if (!data) throw new Error('Réponse incomplète');
    } catch (e: any) {
      const msg = e?.message ?? 'Erreur réseau';
      setError(`Isochrones — ${msg}`);
      throw new Error(msg);
    }
    console.log('[map] battle response:', data.error ?? `${data.nb_pois} POIs, ${data.nb_features} features`);
    if (data.error) {
      // Tronquer les erreurs HTML (ex: page 521 Supabase/Cloudflare)
      const rawErr: string = String(data.error);
      const cleanErr = rawErr.startsWith('<') ? 'Service temporairement indisponible (503/521)' : rawErr.slice(0, 200);
      setError(`Isochrones — ${cleanErr}`);
      throw new Error(data.error);
    }
    // Afficher les isochrones bruts (rings) — couvre cache hit et ORS path.
    // La bataille (ST_Difference) n'est déclenchée que sur clic du bouton BATAILLE.
    if (data.battleGeoJSON?.features?.length > 0) {
      const rawRings = (data.battleGeoJSON.features as any[])
        .filter((f: any) => f?.geometry)
        .map((f: any) => ({
          cirfa_id: String(f.properties?.cirfa_id ?? f.properties?.id ?? ''),
          nom:      String(f.properties?.nom ?? ''),
          lat:      Number(f.properties?.lat ?? 0),
          lng:      Number(f.properties?.lng ?? 0),
          palier:   Number(f.properties?.palier ?? 0),
          geojson:  f.geometry,
        }));
      mapLayers.clearBattlePartialRings();
      mapLayers.addBattlePartialRings(rawRings);
      setBattleFeatures(data.battleGeoJSON.features);
    }
    // poisForMap peut être absent des anciens caches v3 — fallback depuis les ring features
    let poisForMap: { id: string; nom: string; lat: number; lng: number; categorie?: string; adresse?: string; ville?: string }[] = data.poisForMap ?? [];
    if (poisForMap.length === 0 && data.battleGeoJSON?.features?.length > 0) {
      const poisSeen = new Set<string>();
      for (const f of data.battleGeoJSON.features as any[]) {
        const p = f?.properties ?? {};
        const cid = String(p.cirfa_id ?? p.id ?? '');
        const lat = Number(p.lat), lng = Number(p.lng);
        if (cid && !poisSeen.has(cid) && !isNaN(lat) && !isNaN(lng) && lat && lng) {
          poisSeen.add(cid);
          poisForMap.push({ id: cid, nom: String(p.nom ?? ''), lat, lng, categorie: params.category, adresse: String(p.adresse ?? ''), ville: String(p.ville ?? '') });
        }
      }
    }
    if (data.battleCacheKey) setBattleCacheKey(data.battleCacheKey);
    if (poisForMap.length > 0) {
      setBattlePois(poisForMap as any[]);
      setZoneData({
        coordonnees: { lat: poisForMap[0].lat, lng: poisForMap[0].lng },
        pois: poisForMap as any[],
        nb_pois: poisForMap.length,
        categories: { [params.category]: poisForMap.length },
        couleur_overrides: {},
        ville: params.filtre_ville ?? '',
        rayon_metres: null,
        rayon_poi_metres: null,
      });
    }
    // Fusionner tous les rings en un seul MultiPolygon simplifié (client-side, pas de Turf)
    const allPolygons: number[][][][] = [];
    // Grouper les géométries par cirfa_id pour le calcul couverture par POI
    const groupMap = new Map<string, { nom: string; geoms: string[] }>();
    for (const f of data.battleGeoJSON?.features ?? []) {
      if (f.properties?.feature_type !== 'ring') continue;
      const geom = f.geometry;
      if (!geom) continue;
      if (geom.type === 'Polygon')      allPolygons.push(geom.coordinates);
      else if (geom.type === 'MultiPolygon') allPolygons.push(...geom.coordinates);
      const cid = String(f.properties?.cirfa_id ?? f.properties?.id ?? '');
      const nom = String(f.properties?.nom ?? '');
      if (cid) {
        if (!groupMap.has(cid)) groupMap.set(cid, { nom, geoms: [] });
        groupMap.get(cid)!.geoms.push(JSON.stringify(geom));
      }
    }
    // Réduire à 3 décimales (~111m) pour alléger le payload (~10× moins de bytes)
    const multiPoly = { type: 'MultiPolygon', coordinates: allPolygons };
    const simplified = JSON.parse(JSON.stringify(multiPoly, (_, v) =>
      typeof v === 'number' ? Math.round(v * 1000) / 1000 : v
    ));
    const geometry  = allPolygons.length > 0 ? JSON.stringify(simplified) : '';
    const poiGroups = [...groupMap.entries()].map(([id, { nom, geoms }]) => ({ id, nom, geometries: geoms }));
    // Convertir les ring features en RingEntry pour le bouton BATAILLE (Phase 2)
    const battleRings = (data.battleGeoJSON?.features ?? [])
      .filter((f: any) => f?.properties?.feature_type === 'ring' && f?.geometry)
      .map((f: any) => ({
        cirfa_id: String(f.properties.cirfa_id ?? f.properties.id ?? ''),
        nom:      String(f.properties.nom ?? ''),
        lat:      Number(f.properties.lat ?? 0),
        lng:      Number(f.properties.lng ?? 0),
        palier:   Number(f.properties.palier ?? 0),
        geojson:  JSON.stringify(f.geometry),
      }));
    return { geometry, nb_pois: data.nb_pois ?? 0, poiGroups, battleRings };
  };

  const handleApplyBattle = async (
    rings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: string }[],
    category?: string,
    poisForMap?: { id: string; nom: string; lat: number; lng: number; adresse?: string; ville?: string }[],
    onProgress?: (msg: string, pct: number) => void,
  ): Promise<void> => {
    setError(null);
    // Priorité : utiliser le résultat pré-calculé (déjà fait par la route en Phase 5)
    if (pendingBattleRef.current) {
      const { geoJSON, borders, category: cat, poisForMap: pois } = pendingBattleRef.current;
      mapLayers.applyIsochroneBattle(geoJSON, borders, cat ?? category, pois ?? poisForMap);
      return;
    }
    // Stream NDJSON depuis apply-battle
    const res = await fetch('/api/isochrone-battle/apply-battle', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ rings }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setError(`Bataille — ${err.error ?? `HTTP ${res.status}`}`);
      return;
    }
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const PCT: Record<string, number> = { clip: 15, clip_done: 45, battle: 50, done: 85 };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt: any;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'error') {
          setError(`Bataille — ${evt.message}`);
          throw new Error(evt.message);
        }
        if (evt.type === 'progress') {
          onProgress?.(evt.message, PCT[evt.step] ?? 50);
        }
        if (evt.type === 'result') {
          console.log('[handleApplyBattle] result received — nb_rings:', evt.nb_rings, '| features:', evt.battleGeoJSON?.features?.length);
          onProgress?.(`${evt.nb_rings} zones, ${evt.nb_borders} bordures`, 95);
          if (evt.battleGeoJSON?.features?.length > 0) {
            mapLayers.applyIsochroneBattle(evt.battleGeoJSON, evt.battleBorders ?? null, category, poisForMap);
            setBattleFeatures(evt.battleGeoJSON.features);
          }
        }
      }
    }
    reader.releaseLock();
  };

  const handleDirectBattleV2 = async (
    params: DirectBattleV2Params,
    onProgress?: (msg: string) => void,
  ): Promise<void> => {
    setError(null);
    mapLayers.clearBattlePartialRings();
    try {
      const res = await fetch('/api/isochrone-battle-v2', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(params),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let data: any;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: any;
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === 'error') throw new Error(evt.message ?? 'Erreur inconnue');
          if (evt.type === 'result') { data = evt.data; continue; }
          if (evt.type === 'warning') onProgress?.(`> ! ${evt.message}`);
          else if (evt.type === 'pois_loaded')  onProgress?.(`> ${evt.total} POIs chargés`);
          else if (evt.type === 'rings_loaded') onProgress?.(`> ${evt.count} anneaux en cache (${evt.missing} manquants)`);
          else if (evt.type === 'computing')    onProgress?.(`> ${evt.message}`);
        }
      }
      reader.releaseLock();
      if (!data) throw new Error('Réponse incomplète');
      if (data.error) throw new Error(data.error);

      // Afficher le résultat sur la carte
      if (data.battleGeoJSON?.features?.length > 0) {
        mapLayers.applyIsochroneBattle(data.battleGeoJSON, null, params.category, data.poisForMap);
        setBattleFeatures(data.battleGeoJSON.features);
      }

      // Mettre à jour les POIs sur la carte
      const poisForMap = data.poisForMap ?? [];
      if (poisForMap.length > 0) {
        setBattlePois(poisForMap);
        setZoneData({
          coordonnees: { lat: poisForMap[0].lat, lng: poisForMap[0].lng },
          pois: poisForMap,
          nb_pois: poisForMap.length,
          categories: { [params.category]: poisForMap.length },
          couleur_overrides: {},
          ville: params.filtre_ville ?? '',
          rayon_metres: null,
          rayon_poi_metres: null,
        });
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Erreur réseau';
      setError(`Bataille v2 — ${msg}`);
      throw new Error(msg);
    }
  };

  const activeCats = zoneData?.categories ? Object.keys(zoneData.categories).sort() : [];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', background: '#060608' }}>
      <FilterPanel
        sendMessage={chat.sendMessage}
        onDirectSearch={handleDirectSearch}
        onDirectBattle={handleDirectBattle}
        onDirectBattleV2={handleDirectBattleV2}
        onApplyBattle={handleApplyBattle}
        isLoading={chat.isLoading}
        error={error}
        zoneData={zoneData}
        voronoiVisible={mapLayers.voronoiVisible}
        setVoronoiVisible={mapLayers.setVoronoiVisible}
        battleVisible={mapLayers.battleVisible}
        setBattleVisible={mapLayers.setBattleVisible}
        battleOuterFillVisible={mapLayers.battleOuterFillVisible}
        setBattleOuterFillVisible={mapLayers.setBattleOuterFillVisible}
        isochroneVisible={mapLayers.isochroneVisible}
        setIsochroneVisible={mapLayers.setIsochroneVisible}
        setShowSavePanel={savedMaps.setShowSavePanel}
        coverageSummary={coverageSummary}
      />
      <MapPanel
        mapContainerRef={mapContainerRef}
        zoneData={zoneData}
        activeCats={activeCats}
        isochroneVisible={mapLayers.isochroneVisible}
        isochroneMinutes={mapLayers.isochroneMinutes}
        isochroneMode={mapLayers.isochroneMode}
        isochroneFromCache={mapLayers.isochroneFromCache}
        isochroneCachedAt={mapLayers.isochroneCachedAt}
        setIsochroneVisible={mapLayers.setIsochroneVisible}
        recalculerIsochrone={chat.recalculerIsochrone}
        isLoading={chat.isLoading}
        voronoiVisible={mapLayers.voronoiVisible}
        voronoiCategory={mapLayers.voronoiCategory}
        voronoiCirfas={mapLayers.voronoiCirfas}
        setVoronoiVisible={mapLayers.setVoronoiVisible}
        voronoiDataForSaveRef={savedMaps.voronoiDataForSaveRef}
        setShowSavePanel={savedMaps.setShowSavePanel}
        setSaveError={savedMaps.setSaveError}
        battleVisible={mapLayers.battleVisible}
        battleCategory={mapLayers.battleCategory}
        battleCirfas={mapLayers.battleCirfas}
        setBattleVisible={mapLayers.setBattleVisible}
        battleMaxPalier={mapLayers.battleMaxPalier}
        setBattleMaxPalier={mapLayers.setBattleMaxPalier}
        carreauxVisible={mapLayers.carreauxVisible}
        carreauxLoaded={mapLayers.carreauxLoaded}
        carreauxLabel={mapLayers.carreauxLabel}
        carreauxIndicateur={mapLayers.carreauxIndicateur}
        carreauxPalette={mapLayers.carreauxPalette}
        carreauxOpacity={mapLayers.carreauxOpacity}
        setCarreauxVisible={mapLayers.setCarreauxVisible}
        setCarreauxIndicateur={mapLayers.setCarreauxIndicateur}
        setCarreauxPalette={mapLayers.setCarreauxPalette}
        setCarreauxOpacity={mapLayers.setCarreauxOpacity}
        selectedBillboard={selectedBillboard}
        closeBillboardDrawer={() => setSelectedBillboard(null)}
        mapStyleUrl={mapStyleUrl}
        mapStyles={MAP_STYLES as unknown as { id: string; label: string; url: string }[]}
        onMapStyleChange={handleMapStyleChange}
      />
      {battleFeatures.length > 0 && (
        <button
          onClick={() => setIsResultsPanelOpen(true)}
          style={{ position: 'fixed', bottom: 24, right: 16, zIndex: 40, background: '#0a0a12', border: '1px solid #a855f7', color: '#a855f7', fontFamily: 'Orbitron, sans-serif', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', padding: '8px 14px', borderRadius: 2, cursor: 'pointer' }}
        >
          Résultats
        </button>
      )}
      <CoverageResultsPanel
        isOpen={isResultsPanelOpen}
        onClose={() => setIsResultsPanelOpen(false)}
        battleFeatures={battleFeatures}
        pois={battlePois}
        onResultsReady={setCoverageSummary}
        battleCacheKey={battleCacheKey ?? undefined}
      />
      <style>{`
        @keyframes mapSlide {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(250%); }
          100% { transform: translateX(250%); }
        }
        .maplibregl-popup-content {
          background:#fff!important;border:none!important;padding:0!important;
          box-shadow:0 2px 8px rgba(0,0,0,0.15)!important;border-radius:4px!important;
        }
      `}</style>
    </div>
  );
}
