'use client';

import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { ZoneData, IsochroneData, VoronoiData, CarreauxData } from '@/types/spatial';
import type { POI } from '@/types/poi';

/** Shape minimale d'une part de message UIMessage (tool-call, output-available) */
interface ToolPart {
  type?: string;
  state?: string;
  toolCallId?: string;
  /** Output structuré renvoyé par l'outil — typé dynamiquement selon le tool name */
  output?: Record<string, unknown> & { [key: string]: unknown };
}

interface UseToolProcessorOpts {
  messages: UIMessage[];
  setZoneData: React.Dispatch<React.SetStateAction<ZoneData | null>>;
  setError: (msg: string | null) => void;
  applyIsochrones:      (data: IsochroneData) => void;
  applyVoronoi:         (data: VoronoiData) => void;
  applyIsochroneBattle: (rings: { type: string; features: GeoJSON.Feature[] }, borders: { type: string; features: GeoJSON.Feature[] } | null, category?: string, poisForMap?: { id: string; nom: string; lat: number; lng: number; adresse?: string; ville?: string }[]) => void;
  loadCarreauxFromAI:   (cd: CarreauxData) => Promise<void>;
  carreauxSourcesRef:    React.MutableRefObject<{ tableName: string; name: string }[]>;
  carreauxConfigForSaveRef: React.MutableRefObject<{
    tableName: string; indicateur: string; indicateur_label: string; coordonnees: { lat: number; lng: number };
  } | null>;
  flyToCoords: (lat: number, lng: number) => void;
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
  flyToCoords,
}: UseToolProcessorOpts) {
  const processedToolIds = useRef(new Set<string>());

  useEffect(() => {
    // Accumule les résultats analyser_zone_pois pour éviter le batching race condition
    const zonePoiResults: ZoneData[] = [];
    const isochronesToApply: IsochroneData[] = [];

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;

      for (let partIdx = 0; partIdx < (msg.parts ?? []).length; partIdx++) {
        const p = (msg.parts as unknown as ToolPart[])[partIdx];

        if (p.state !== 'output-available') continue;
        if (!p.type?.startsWith('tool-')) continue;

        // Clé robuste : toolCallId si dispo, sinon msgId+index
        const key = p.toolCallId ?? `${msg.id}:${partIdx}`;
        if (processedToolIds.current.has(key)) continue;
        processedToolIds.current.add(key);

        const toolName = (p.type as string).replace(/^tool-/, '');
        // Cast vers Record arbitraire — la forme exacte dépend du tool name (assertion ZoneData/CarreauxData ci-dessous)
        const result = p.output as Record<string, unknown> | undefined;

        if (toolName === 'analyser_zone_pois' && result?.coordonnees) {
          zonePoiResults.push(result as unknown as ZoneData);
          const iso = result.isochroneGeoJSON as (IsochroneData & { _fromCache?: boolean; _cachedAt?: string }) | undefined;
          if (iso?.features && iso.features.length > 0) {
            isochronesToApply.push({
              ...iso,
              _meta: { mode: (result.isochrone_mode as string) ?? 'walk', minutes: (result.isochrone_minutes as number) ?? 0 },
              _fromCache: iso._fromCache ?? false,
              _cachedAt:  iso._cachedAt ?? undefined,
            });
          }
        } else if (toolName === 'voronoi_analysis' && result?.error) {
          setError(`⬡ Voronoï — Erreur : ${result.error}`);
        } else if (toolName === 'voronoi_analysis' && result) {
          const vGeo = result.voronoiGeoJSON as VoronoiData | undefined;
          if (vGeo?.features && vGeo.features.length > 0) applyVoronoi(vGeo);
          if (result.poisForMap) setZoneData(result.poisForMap as unknown as ZoneData);

        } else if (toolName === 'afficher_carreaux' && result) {
          loadCarreauxFromAI(result as unknown as CarreauxData);
          const sources = carreauxSourcesRef.current;
          if (sources.length > 0) {
            carreauxConfigForSaveRef.current = {
              tableName:        sources[0].tableName,
              indicateur:       result.indicateur as string,
              indicateur_label: result.indicateur_label as string,
              coordonnees:      result.coordonnees as { lat: number; lng: number },
            };
          }

        } else if (toolName === 'analyse_complete' && result?.coordonnees) {
          const c = result.coordonnees as { lat: number; lng: number };
          flyToCoords(c.lat, c.lng);

        } else if (toolName === 'isochrone_battle' && result) {
          if (result.error) {
            const raw = String(result.error);
            const friendly =
              raw.includes('Timeout') || raw.includes('AbortError')
                ? "⚔️ Bataille d'Isochrones — Timeout. Lance depuis /map d'abord pour remplir le cache ORS."
                : raw.includes('Moins de 2') || raw.includes('moins de 2')
                ? "⚔️ Bataille d'Isochrones — Pas assez de CIRFA trouvés dans cette zone."
                : `⚔️ Bataille d'Isochrones — ${raw}`;
            console.error('[useToolProcessor] isochrone_battle error:', raw);
            setError(friendly);
          } else {
            const battleGeo = result.battleGeoJSON as { type: string; features: GeoJSON.Feature[] } | undefined;
            if (battleGeo?.features && battleGeo.features.length > 0) {
              applyIsochroneBattle(
                battleGeo,
                (result.battleBorders as { type: string; features: GeoJSON.Feature[] } | null) ?? null,
                result.category as string | undefined,
                result.poisForMap as { id: string; nom: string; lat: number; lng: number; adresse?: string; ville?: string }[] | undefined
              );
            }
          }
        }
      }
    }

    // Fusionner tous les résultats analyser_zone_pois en un seul appel setZoneData
    if (zonePoiResults.length > 0) {
      setZoneData(prev => {
        if (!prev) {
          let merged = zonePoiResults[0];
          for (let i = 1; i < zonePoiResults.length; i++) {
            const next = zonePoiResults[i];
            const existingIds = new Set(merged.pois.map((p: POI) => p.id));
            const newPois = next.pois.filter((p: POI) => !existingIds.has(p.id));
            merged = {
              ...merged,
              pois: [...merged.pois, ...newPois],
              nb_pois: merged.pois.length + newPois.length,
              categories: { ...merged.categories, ...next.categories },
              couleur_overrides: { ...merged.couleur_overrides, ...next.couleur_overrides },
            };
          }
          return merged;
        }
        let result = { ...prev };
        const existingIds = new Set(prev.pois.map((p: POI) => p.id));
        for (const zoneResult of zonePoiResults) {
          const newPois = zoneResult.pois.filter((p: POI) => !existingIds.has(p.id));
          newPois.forEach(p => existingIds.add(p.id));
          result = {
            ...result,
            pois: [...result.pois, ...newPois],
            categories: { ...result.categories, ...zoneResult.categories },
            couleur_overrides: { ...result.couleur_overrides, ...zoneResult.couleur_overrides },
          };
        }
        result.nb_pois = result.pois.length;
        return result;
      });
    }

    if (isochronesToApply.length > 0) {
      isochronesToApply.forEach(iso => applyIsochrones(iso));
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
}
