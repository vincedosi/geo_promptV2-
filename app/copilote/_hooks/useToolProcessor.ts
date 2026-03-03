'use client';

import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { ZoneData, IsochroneData, VoronoiData, CarreauxData } from '@/types/spatial';

interface UseToolProcessorOpts {
  messages: UIMessage[];
  mapReady: boolean;
  setZoneData: React.Dispatch<React.SetStateAction<ZoneData | null>>;
  setError: (msg: string | null) => void;
  applyIsochrones:      (data: IsochroneData) => void;
  applyVoronoi:         (data: VoronoiData) => void;
  applyIsochroneBattle: (rings: { type: string; features: GeoJSON.Feature[] }, borders: { type: string; features: GeoJSON.Feature[] } | null, category?: string) => void;
  loadCarreauxFromAI:   (cd: CarreauxData) => Promise<void>;
  carreauxSourcesRef:    React.MutableRefObject<{ tableName: string; name: string }[]>;
  carreauxConfigForSaveRef: React.MutableRefObject<{
    tableName: string; indicateur: string; indicateur_label: string; coordonnees: { lat: number; lng: number };
  } | null>;
}

export function useToolProcessor({
  messages,
  setZoneData,
  setError,
  applyIsochrones,
  applyVoronoi,
  applyIsochroneBattle,
  loadCarreauxFromAI,
  carreauxSourcesRef,
  carreauxConfigForSaveRef,
}: UseToolProcessorOpts) {
  const processedToolIds = useRef(new Set<string>());

  useEffect(() => {
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      for (const part of msg.parts) {
        const p = part as any;
        if (!p.toolCallId || p.state !== 'output-available') continue;
        const key = p.toolCallId as string;
        if (processedToolIds.current.has(key)) continue;
        processedToolIds.current.add(key);

        const toolName = (p.type as string).replace(/^tool-/, '');
        const result   = p.output;

        if (toolName === 'analyser_zone_pois' && result?.coordonnees) {
          setZoneData(prev => {
            if (!prev) return result as ZoneData;
            const existingIds = new Set(prev.pois.map((p: any) => p.id));
            const newPois = (result as ZoneData).pois.filter((p: any) => !existingIds.has(p.id));
            return {
              ...prev,
              pois: [...prev.pois, ...newPois],
              nb_pois: prev.pois.length + newPois.length,
              categories: { ...prev.categories, ...(result as ZoneData).categories },
              couleur_overrides: { ...prev.couleur_overrides, ...(result as ZoneData).couleur_overrides },
            };
          });
          const iso = result.isochroneGeoJSON;
          if (iso?.features?.length > 0) {
            applyIsochrones({
              ...iso,
              _meta: { mode: result.isochrone_mode ?? 'walk', minutes: result.isochrone_minutes ?? 0 },
              _fromCache: iso._fromCache ?? false,
              _cachedAt:  iso._cachedAt  ?? null,
            });
          }
        } else if (toolName === 'voronoi_analysis' && result?.error) {
          setError(`⬡ Voronoï — Erreur : ${result.error}`);
        } else if (toolName === 'voronoi_analysis' && result) {
          if (result.voronoiGeoJSON?.features?.length > 0) applyVoronoi(result.voronoiGeoJSON);
          if (result.poisForMap) setZoneData(result.poisForMap as ZoneData);

        } else if (toolName === 'afficher_carreaux' && result) {
          loadCarreauxFromAI(result as CarreauxData);
          const sources = carreauxSourcesRef.current;
          if (sources.length > 0) {
            carreauxConfigForSaveRef.current = {
              tableName:        sources[0].tableName,
              indicateur:       result.indicateur,
              indicateur_label: result.indicateur_label,
              coordonnees:      result.coordonnees,
            };
          }

        } else if (toolName === 'analyser_panneaux' && result?.coordonnees) {
          setZoneData(prev => {
            if (!prev) return result as ZoneData;
            const existingIds = new Set(prev.pois.map((p: any) => p.id));
            const newPois = (result as ZoneData).pois.filter((p: any) => !existingIds.has(p.id));
            return {
              ...prev,
              pois: [...prev.pois, ...newPois],
              nb_pois: prev.pois.length + newPois.length,
              categories: { ...prev.categories, ...(result as ZoneData).categories },
              couleur_overrides: { ...prev.couleur_overrides, ...(result as ZoneData).couleur_overrides },
            };
          });

        } else if (toolName === 'isochrone_battle' && result) {
          if (result.error) {
            const raw = String(result.error);
            const friendly =
              raw.includes('Timeout') || raw.includes('AbortError')
                ? "⚔️ Bataille d'Isochrones — Timeout. Lance depuis /map d'abord pour remplir le cache ORS."
                : raw.includes('Moins de 2') || raw.includes('moins de 2')
                ? "⚔️ Bataille d'Isochrones — Pas assez de CIRFA trouvés dans cette zone."
                : `⚔️ Bataille d'Isochrones — ${raw}`;
            console.error('[copilote] Erreur Bataille:', raw);
            setError(friendly);
          } else if (result.battleGeoJSON?.features?.length > 0) {
            applyIsochroneBattle(
              result.battleGeoJSON,
              result.battleBorders ?? null,
              result.category
            );
          }
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
}
