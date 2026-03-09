'use client';

import { useState, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { circleGeoJSON, getCatColor } from './_lib/constants';
import { useMapInit }          from './_hooks/useMapInit';
import { useSavedMaps }        from './_hooks/useSavedMaps';
import { useMapLayers }        from './_hooks/useMapLayers';
import { useChatControls }     from './_hooks/useChatControls';
import { useRateLimitHandler } from './_hooks/useRateLimitHandler';
import { useToolProcessor }    from './_hooks/useToolProcessor';
import { useProviderSelector } from './_hooks/useProviderSelector';
import { ChatPanel }           from './_components/ChatPanel';
import { MapPanel }            from './_components/MapPanel';
import type { ZoneData }       from '@/types/spatial';
import { exportOohReport, type OohExportData } from './_lib/ooh-export';

interface SelectedBillboard {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  format?: string;
  score?: number | null;
  audience?: number | null;
  rank?: number | null;
  regie?: string;
}

export default function CopilotePage() {
  const [error,    setError]    = useState<string | null>(null);
  const [zoneData, setZoneData] = useState<ZoneData | null>(null);
  const [selectedBillboard, setSelectedBillboard] = useState<SelectedBillboard | null>(null);

  // ── Map init ───────────────────────────────────────────────────────────────
  const { mapContainerRef, mapRef, markersRef, mapReady } = useMapInit(zoneData, setSelectedBillboard);

  // ── Saved maps ─────────────────────────────────────────────────────────────
  const savedMaps = useSavedMaps({ zoneData, setZoneData });

  // ── Map layers (visualisation) ─────────────────────────────────────────────
  const mapLayers = useMapLayers({
    mapRef,
    mapReady,
    isochroneDataForSaveRef:  savedMaps.isochroneDataForSaveRef,
    carreauxConfigForSaveRef: savedMaps.carreauxConfigForSaveRef,
    voronoiDataForSaveRef:    savedMaps.voronoiDataForSaveRef,
    setSaveName:              savedMaps.setSaveName,
  });

  // ── Provider selector ──────────────────────────────────────────────────────
  const providerSelector = useProviderSelector();

  // ── Chat ───────────────────────────────────────────────────────────────────
  const chat = useChatControls({
    setError,
    setZoneData,
    setIsochroneFromCache: mapLayers.setIsochroneFromCache,
    provider: providerSelector.provider,
  });

  // ── Rate limit ─────────────────────────────────────────────────────────────
  const rateLimit = useRateLimitHandler({
    chatError:          chat.chatError,
    setError,
    sendChatMessage:    chat.sendChatMessage,
    lastUserMessageRef: chat.lastUserMessageRef,
  });

  // ── Tool processor ─────────────────────────────────────────────────────────
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
    applyNetworkCoverage:     mapLayers.applyNetworkCoverage,
    flyToCoords: (lat, lng) => {
      if (mapRef.current && mapReady) {
        mapRef.current.flyTo({ center: [lng, lat], zoom: 11, duration: 1200 });
      }
    },
    triggerOohExport: async (data: OohExportData) => {
      setError('📄 Génération du rapport Excel en cours…');
      await exportOohReport(data, mapRef, (msg) => {
        if (msg) setError(`📄 ${msg}`);
        else setError(null);
      });
    },
  });

  // ── Câblage dépendances circulaires (savedMaps ↔ mapLayers/chat) ───────────
  savedMaps.applyIsochronesRef.current = mapLayers.applyIsochrones;
  savedMaps.applyVoronoiRef.current    = mapLayers.applyVoronoi;
  savedMaps.loadCarreauxRef.current    = mapLayers.loadCarreauxFromAI;
  savedMaps.setMessagesRef.current     = chat.setMessages;

  // ── Rendu zone (markers + cercle + flyTo) ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !zoneData || !zoneData.coordonnees) return;

    const { lat, lng } = zoneData.coordonnees;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // ── Seuil : au-delà de 300 POI → GPU layers (heatmap + circles) ─────
    // Les DOM markers sont catastrophiques à grande échelle (5000 éléments HTML)
    const MAX_DOM_MARKERS = 300;
    const useLayers = zoneData.pois.length > MAX_DOM_MARKERS;

    // ── Source heatmap + cercles GPU ──────────────────────────────────────
    const heatSource = map.getSource('pois-heat') as maplibregl.GeoJSONSource | undefined;
    if (heatSource) {
      heatSource.setData({
        type: 'FeatureCollection',
        features: zoneData.pois.map(p => {
          const color = zoneData.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
            properties: {
              id:             p.id,
              categorie:      p.categorie,
              sous_categorie: p.sous_categorie ?? '',
              format:         p.sous_categorie ?? '',
              nom:            p.nom ?? '',
              adresse:        p.adresse ?? '',
              regie:          p.adresse ?? '',
              color,
              lat:            p.lat,
              lng:            p.lng,
              audience:       (p as any).audience ?? null,
              score_ooh:      (p as any).score_ooh ?? null,
              rank:           (p as any).rank ?? null,
            },
          };
        }),
      });
    }
    // Afficher/masquer le layer cercles GPU selon le mode
    try {
      map.setLayoutProperty('pois-circles', 'visibility', useLayers ? 'visible' : 'none');
    } catch { /* layer pas encore prêt */ }

    (map.getSource('zone-circle') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: zoneData.rayon_metres ? [circleGeoJSON(lng, lat, zoneData.rayon_metres)] : [],
    });
    map.triggerRepaint();

    // ── DOM markers (≤ 300 POI seulement) ────────────────────────────────
    if (!useLayers) {
      zoneData.pois.forEach((p) => {
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
          (audienceVal != null ? `<br/><span style="color:#10b981;font-size:12px;font-weight:600">👥 ${Number(audienceVal).toLocaleString('fr-FR')} personnes</span>` : '') +
          (p.adresse ? `<br/><span style="color:#64748b;font-size:11px">📍 ${p.adresse}</span>` : '') +
          `</div>`
        );
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);

        // Clic sur les panneaux → ouvrir le drawer Street View
        if (p.categorie === 'panneaux' || p.categorie === 'top_ooh') {
          el.addEventListener('click', () => {
            setSelectedBillboard({
              id: p.id,
              nom: p.nom ?? 'Panneau',
              lat: p.lat,
              lng: p.lng,
              format: p.sous_categorie ?? undefined,
              score: (p as any).score_ooh ?? null,
              audience: (p as any).audience ?? null,
              rank: (p as any).rank ?? null,
              regie: p.adresse ?? undefined,
            });
          });
        }
      });
    }

    // Marqueur ville (toujours affiché)
    const cityEl = document.createElement('div');
    cityEl.innerHTML = '📍';
    cityEl.style.cssText = 'font-size:24px;cursor:default;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
    markersRef.current.push(
      new maplibregl.Marker({ element: cityEl, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map)
    );

    const r = zoneData.rayon_metres, rPoi = zoneData.rayon_poi_metres;
    if (zoneData.pois.length > 1) {
      const lats = zoneData.pois.map(p => p.lat);
      const lngs = zoneData.pois.map(p => p.lng);
      // Grand dataset (heatmap mode) → maxZoom 7 pour voir la densité nationale
      const maxZ = useLayers ? 7 : 14;
      map.fitBounds(
        new maplibregl.LngLatBounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]),
        { padding: 40, maxZoom: maxZ, duration: 1200 }
      );
      return;
    }
    let zoom: number;
    if (rPoi) {
      zoom = rPoi < 300 ? 15 : rPoi < 800 ? 14 : rPoi < 2000 ? 13 : 12;
    } else if (r) {
      zoom = r < 1500 ? 14 : r < 4000 ? 13 : 11;
    } else {
      zoom = 12;
    }
    map.flyTo({ center: [lng, lat], zoom, duration: 1200 });
  }, [zoneData, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Masquer les markers DOM aux petits zooms (heatmap prend le relais) ────
  // Seulement en mode petit dataset (≤300) — en mode GPU le seul marker est la ville
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const updateMarkerVisibility = () => {
      const z = map.getZoom();
      const opacity = z < 10 ? 0 : z < 13 ? (z - 10) / 3 : 1;
      const events  = opacity > 0 ? 'auto' : 'none';
      markersRef.current.forEach(m => {
        const el = m.getElement();
        // Ne pas masquer le marqueur ville (emoji 📍 plus grand)
        if (el.style.fontSize === '24px') return;
        el.style.opacity       = String(opacity);
        el.style.pointerEvents = events;
      });
    };

    map.on('zoom', updateMarkerVisibility);
    updateMarkerVisibility();
    return () => { map.off('zoom', updateMarkerVisibility); };
  }, [mapReady, mapRef, markersRef]);

  const activeCats = zoneData?.categories ? Object.keys(zoneData.categories).sort() : [];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', background: '#060608', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <ChatPanel
        messages={chat.messages}
        isLoading={chat.isLoading}
        input={chat.input}
        setInput={chat.setInput}
        handleSubmit={chat.handleSubmit}
        handleKeyDown={chat.handleKeyDown}
        sendMessage={chat.sendMessage}
        messagesEndRef={chat.messagesEndRef}
        rateLimitCooldown={rateLimit.rateLimitCooldown}
        cancelCooldown={rateLimit.cancelCooldown}
        error={error}
        showSavePanel={savedMaps.showSavePanel}
        showLoadPanel={savedMaps.showLoadPanel}
        setShowSavePanel={savedMaps.setShowSavePanel}
        setShowLoadPanel={savedMaps.setShowLoadPanel}
        saveName={savedMaps.saveName}
        setSaveName={savedMaps.setSaveName}
        saveLoading={savedMaps.saveLoading}
        saveError={savedMaps.saveError}
        setSaveError={savedMaps.setSaveError}
        savedMaps={savedMaps.savedMaps}
        saveCurrentMap={savedMaps.saveCurrentMap}
        loadSavedMaps={savedMaps.loadSavedMaps}
        loadMap={savedMaps.loadMap}
        deleteMap={savedMaps.deleteMap}
        zoneData={zoneData}
        provider={providerSelector.provider}
        setProvider={providerSelector.setProvider}
        providerStatus={providerSelector.providerStatus}
        statusLoading={providerSelector.statusLoading}
        refreshProviderStatus={providerSelector.refreshStatus}
        sessionTokens={chat.sessionTokens}
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
      />
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
        @keyframes bounce { 0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)} }
        .maplibregl-popup-content { background:#fff!important;border:none!important;padding:0!important;box-shadow:0 2px 8px rgba(0,0,0,0.15)!important;border-radius:8px!important; }
      `}</style>
    </div>
  );
}
