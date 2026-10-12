'use client';
import { logger } from '@/lib/logger';

import { useRef, useState } from 'react';
import type { ZoneData, IsochroneData, VoronoiData, CarreauxData, SavedMap } from '@/types/spatial';

interface UseSavedMapsOpts {
  zoneData: ZoneData | null;
  setZoneData: (v: ZoneData | null) => void;
}

export function useSavedMaps({ zoneData, setZoneData }: UseSavedMapsOpts) {
  const [savedMaps, setSavedMaps] = useState<SavedMap[]>([]);
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [showLoadPanel, setShowLoadPanel] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Refs for data to include in saves
  const isochroneDataForSaveRef = useRef<IsochroneData | null>(null);
  const carreauxConfigForSaveRef = useRef<{
    tableName: string; indicateur: string; indicateur_label: string; coordonnees: { lat: number; lng: number };
  } | null>(null);
  const voronoiDataForSaveRef = useRef<VoronoiData | null>(null);

  // Refs wired by page.tsx to break circular dependency with useMapLayers
  const applyIsochronesRef = useRef<((d: IsochroneData) => void) | null>(null);
  const applyVoronoiRef    = useRef<((d: VoronoiData) => void) | null>(null);
  const loadCarreauxRef    = useRef<((cd: CarreauxData) => Promise<void>) | null>(null);

  const saveCurrentMap = async () => {
    if (!saveName.trim()) { setSaveError('Entrez un nom pour cette carte'); return; }
    setSaveLoading(true);
    setSaveError(null);

    try {
      const res = await fetch('/api/saved-maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:            saveName.trim(),
          zone_data:       zoneData ?? undefined,
          carreaux_config: carreauxConfigForSaveRef.current ?? undefined,
          isochrone_data:  isochroneDataForSaveRef.current ?? undefined,
          voronoi_data:    voronoiDataForSaveRef.current ?? undefined,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setSaveName('');
      setShowSavePanel(false);
      loadSavedMaps();
      logger.info('Copilote', `Carte sauvegardée: "${saveName}" (${data.id})`);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaveLoading(false);
    }
  };

  const loadSavedMaps = async () => {
    try {
      const res = await fetch('/api/saved-maps');
      const data = await res.json();
      setSavedMaps(data.maps ?? []);
    } catch { /* silencieux */ }
  };

  const loadMap = async (id: string) => {
    try {
      const res = await fetch(`/api/saved-maps/${id}`);
      const data = await res.json();
      if (data.error) return;

      if (data.zone_data) setZoneData(data.zone_data);

      if (data.carreaux_config) {
        const cc = data.carreaux_config;
        carreauxConfigForSaveRef.current = cc;
        await loadCarreauxRef.current?.({
          action: 'afficher_carreaux',
          indicateur:       cc.indicateur,
          indicateur_label: cc.indicateur_label,
          coordonnees:      cc.coordonnees,
        });
      }
      if (data.isochrone_data?.features?.length > 0) {
        applyIsochronesRef.current?.(data.isochrone_data);
      }
      if (data.voronoi_data?.features?.length > 0) {
        applyVoronoiRef.current?.(data.voronoi_data);
      }

      setShowLoadPanel(false);
      logger.info('Copilote', `Carte chargée: "${data.name}"`);
    } catch (err: unknown) {
      console.error('[Copilote] Erreur chargement carte:', err);
    }
  };

  const deleteMap = async (id: string) => {
    await fetch(`/api/saved-maps?id=${id}`, { method: 'DELETE' });
    setSavedMaps(prev => prev.filter(m => m.id !== id));
  };

  return {
    savedMaps,
    showSavePanel, setShowSavePanel,
    showLoadPanel, setShowLoadPanel,
    saveName, setSaveName,
    saveLoading,
    saveError, setSaveError,
    // Save/load actions
    saveCurrentMap,
    loadSavedMaps,
    loadMap,
    deleteMap,
    // Data refs for saves
    isochroneDataForSaveRef,
    carreauxConfigForSaveRef,
    voronoiDataForSaveRef,
    // Wiring refs (page.tsx sets these after all hooks are ready)
    applyIsochronesRef,
    applyVoronoiRef,
    loadCarreauxRef,
  };
}
