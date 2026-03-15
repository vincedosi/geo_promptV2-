'use client';

import { useState, useEffect } from 'react';
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
import type { DirectPOISearchParams, DirectBattleParams } from '@/app/map/_components/FilterPanel';
import type { ZoneData }       from '@/types/spatial';
import { exportOohReport, type OohExportData } from '@/app/copilote/_lib/ooh-export';

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
  useEffect(() => {
    const stored = localStorage.getItem('genesis_map_style');
    if (stored) setMapStyleUrl(stored);
  }, []);

  const handleMapStyleChange = (url: string) => {
    setMapStyleUrl(url);
    localStorage.setItem('genesis_map_style', url);
  };

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
    onProgress?: (msg: string) => void,
  ): Promise<{ geometry: string; nb_pois: number }> => {
    setError(null);
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
          filtre_ville:    params.filtre_ville    ?? null,
          filtre_regions:  params.filtre_regions  ?? null,
          metropolitaine:  params.metropolitaine,
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
          if (evt.type === 'pois_loaded') {
            onProgress?.(`> ${evt.total} POIs trouvés — démarrage ORS...`);
          } else if (evt.type === 'progress') {
            const pct = Math.round((evt.completed / evt.total) * 100);
            onProgress?.(`> ${evt.completed}/${evt.total} POIs traités — ${pct}%`);
          } else if (evt.type === 'postgis') {
            onProgress?.(`> [3/3] appel PostGIS (ST_Difference)...`);
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
    if (data.battleGeoJSON?.features?.length > 0) {
      mapLayers.applyIsochroneBattle(data.battleGeoJSON, data.battleBorders ?? null, data.category);
    }
    if (data.poisForMap?.length > 0) {
      setZoneData({
        coordonnees: { lat: data.poisForMap[0].lat, lng: data.poisForMap[0].lng },
        pois: data.poisForMap,
        nb_pois: data.poisForMap.length,
        categories: { [params.category]: data.poisForMap.length },
        couleur_overrides: {},
        ville: params.filtre_ville ?? '',
        rayon_metres: null,
        rayon_poi_metres: null,
      });
    }
    // Fusionner tous les rings en un seul MultiPolygon simplifié (client-side, pas de Turf)
    // Les rings sont déjà non-chevauchants (ST_Difference dans get_isochrone_battle)
    const allPolygons: number[][][][] = [];
    for (const f of data.battleGeoJSON?.features ?? []) {
      if (f.properties?.feature_type !== 'ring') continue;
      const geom = f.geometry;
      if (!geom) continue;
      if (geom.type === 'Polygon')      allPolygons.push(geom.coordinates);
      else if (geom.type === 'MultiPolygon') allPolygons.push(...geom.coordinates);
    }
    // Réduire à 3 décimales (~111m) pour alléger le payload (~10× moins de bytes)
    const multiPoly = { type: 'MultiPolygon', coordinates: allPolygons };
    const simplified = JSON.parse(JSON.stringify(multiPoly, (_, v) =>
      typeof v === 'number' ? Math.round(v * 1000) / 1000 : v
    ));
    const geometry = allPolygons.length > 0 ? JSON.stringify(simplified) : '';
    return { geometry, nb_pois: data.nb_pois ?? 0 };
  };

  const activeCats = zoneData?.categories ? Object.keys(zoneData.categories).sort() : [];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', background: '#060608' }}>
      <FilterPanel
        sendMessage={chat.sendMessage}
        onDirectSearch={handleDirectSearch}
        onDirectBattle={handleDirectBattle}
        isLoading={chat.isLoading}
        error={error}
        zoneData={zoneData}
        loadCarreauxFromAI={mapLayers.loadCarreauxFromAI}
        carreauxVisible={mapLayers.carreauxVisible}
        carreauxLoaded={mapLayers.carreauxLoaded}
        carreauxLabel={mapLayers.carreauxLabel}
        setCarreauxVisible={mapLayers.setCarreauxVisible}
        voronoiVisible={mapLayers.voronoiVisible}
        setVoronoiVisible={mapLayers.setVoronoiVisible}
        battleVisible={mapLayers.battleVisible}
        setBattleVisible={mapLayers.setBattleVisible}
        isochroneVisible={mapLayers.isochroneVisible}
        setIsochroneVisible={mapLayers.setIsochroneVisible}
        setShowSavePanel={savedMaps.setShowSavePanel}
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
        carreauxVisible={mapLayers.carreauxVisible}
        carreauxLoaded={mapLayers.carreauxLoaded}
        carreauxLabel={mapLayers.carreauxLabel}
        setCarreauxVisible={mapLayers.setCarreauxVisible}
        selectedBillboard={selectedBillboard}
        closeBillboardDrawer={() => setSelectedBillboard(null)}
        mapStyleUrl={mapStyleUrl}
        mapStyles={MAP_STYLES as unknown as { id: string; label: string; url: string }[]}
        onMapStyleChange={handleMapStyleChange}
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
