'use client';

import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { ZoneData, IsochroneData, VoronoiData, CarreauxData, NetworkCoverageData } from '@/types/spatial';
import type { OohExportData } from '../_lib/ooh-export';

interface UseToolProcessorOpts {
  messages: UIMessage[];
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
  flyToCoords: (lat: number, lng: number) => void;
  applyNetworkCoverage: (data: NetworkCoverageData) => void;
  triggerOohExport: (data: OohExportData) => Promise<void>;
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
  applyNetworkCoverage,
  triggerOohExport,
}: UseToolProcessorOpts) {
  const processedToolIds = useRef(new Set<string>());

  useEffect(() => {
    // ── Accumule les résultats analyser_zone_pois pour éviter le batching race condition ──
    const zonePoiResults: ZoneData[] = [];
    const isochronesToApply: IsochroneData[] = [];

    console.log('[useToolProcessor] Messages:', messages.length, 'messages');

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      console.log('[useToolProcessor] Assistant message parts:', msg.parts?.length ?? 0);
      
      for (let partIdx = 0; partIdx < (msg.parts ?? []).length; partIdx++) {
        const p = (msg.parts as any[])[partIdx];
        console.log('[useToolProcessor] Part structure:', { type: p.type, toolCallId: p.toolCallId, state: p.state, hasOutput: !!p.output });

        if (p.state !== 'output-available') continue;
        if (!p.type?.startsWith('tool-')) continue;
        // Clé robuste : toolCallId si dispo, sinon msgId+index
        const key = p.toolCallId ?? `${msg.id}:${partIdx}`;
        if (processedToolIds.current.has(key)) {
          console.log('[useToolProcessor] Skipping already processed:', key);
          continue;
        }
        processedToolIds.current.add(key);

        const toolName = (p.type as string).replace(/^tool-/, '');
        const result   = p.output;
        console.log('[useToolProcessor] Processing tool:', toolName, 'Result keys:', result ? Object.keys(result) : 'null');
        console.log('[useToolProcessor] result?.coordonnees:', result?.coordonnees, '| result?.pois?.length:', result?.pois?.length);

        if (toolName === 'analyser_zone_pois' && result?.coordonnees) {
          // ── Accumuler plutôt que d'appeler setZoneData directement ──
          console.log('[useToolProcessor] ✅ Pushing analyser_zone_pois result:', result?.nb_pois, 'POIs');
          zonePoiResults.push(result as ZoneData);
          const iso = result.isochroneGeoJSON;
          if (iso?.features?.length > 0) {
            isochronesToApply.push({
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

        } else if (toolName === 'classer_panneaux_audience' && result?.pois) {
          // Display ranked panneaux with coverage circles on map
          setZoneData(result as ZoneData);
          if (result.coordonnees) flyToCoords(result.coordonnees.lat, result.coordonnees.lng);

        } else if (toolName === 'scorer_panneaux_ooh' && result?.error) {
          setError(`📊 Score OOH — ${result.error}`);
        } else if (toolName === 'scorer_panneaux_ooh' && result?.pois) {
          // Upgrade top_ooh POIs in existing zone data (changes their categorie → purple)
          setZoneData(prev => {
            const topPois = (result as ZoneData).pois;
            const topIds = new Set(topPois.map((p: any) => p.id));
            if (!prev) return result as ZoneData;
            // Upgrade existing POIs that are in top 10 to top_ooh category (purple)
            const updatedPois = prev.pois.map((p: any) =>
              topIds.has(p.id)
                ? { ...topPois.find((t: any) => t.id === p.id), categorie: 'top_ooh' }
                : p
            );
            // Add top_ooh POIs not yet in prev (if scorer ran before analyser_panneaux)
            const existingIds = new Set(prev.pois.map((p: any) => p.id));
            const extraPois = topPois.filter((p: any) => !existingIds.has(p.id));
            const merged = [...updatedPois, ...extraPois];
            return {
              ...prev,
              pois: merged,
              nb_pois: merged.length,
              categories: { ...prev.categories, ...(result as ZoneData).categories },
              couleur_overrides: { ...prev.couleur_overrides, ...(result as ZoneData).couleur_overrides },
            };
          });
          if (result.coordonnees) flyToCoords(result.coordonnees.lat, result.coordonnees.lng);

        } else if (toolName === 'exporter_rapport_ooh' && result?.error) {
          setError(`📄 Export OOH — ${result.error}`);
        } else if (toolName === 'exporter_rapport_ooh' && result?.action === 'export_ooh') {
          triggerOohExport(result as any).catch((err: any) =>
            setError(`📄 Export OOH — ${err.message ?? err}`)
          );

        } else if (toolName === 'analyze_poi_synergy' && result?.pois) {
          // Display synergy results (panneaux near POI with demo scoring)
          setZoneData(result as ZoneData);
          if (result.coordonnees) flyToCoords(result.coordonnees.lat, result.coordonnees.lng);

        } else if (toolName === 'calculate_network_coverage' && result) {
          if (result.error) {
            setError(`📡 Couverture réseau — ${result.error}`);
          } else {
            applyNetworkCoverage(result as NetworkCoverageData);
          }

        } else if (toolName === 'calculate_audience_coverage' && result) {
          if (result.error) {
            setError(`📊 Couverture — ${result.error}`);
          } else {
            if (result.isochroneGeoJSON?.features?.length > 0) {
              applyIsochrones({
                ...result.isochroneGeoJSON,
                _meta:      { mode: result.mode ?? 'drive', minutes: result.travel_time_minutes ?? 0 },
                _fromCache: false,
                _cachedAt:  null,
              });
            }
            if (result.coordonnees) {
              flyToCoords(result.coordonnees.lat, result.coordonnees.lng);
            }
          }

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

    // ── Traiter tous les résultats analyser_zone_pois accumulés en UN SEUL appel ──
    if (zonePoiResults.length > 0) {
      console.log('[useToolProcessor] Fusing', zonePoiResults.length, 'zone results');
      setZoneData(prev => {
        if (!prev) {
          // Premier appel : fusionner tous les résultats entre eux
          let merged = zonePoiResults[0];
          for (let i = 1; i < zonePoiResults.length; i++) {
            const next = zonePoiResults[i];
            const existingIds = new Set(merged.pois.map((p: any) => p.id));
            const newPois = next.pois.filter((p: any) => !existingIds.has(p.id));
            merged = {
              ...merged,
              pois: [...merged.pois, ...newPois],
              nb_pois: merged.pois.length + newPois.length,
              categories: { ...merged.categories, ...next.categories },
              couleur_overrides: { ...merged.couleur_overrides, ...next.couleur_overrides },
            };
          }
          console.log('[useToolProcessor] MERGED (initial):', { nb_pois: merged.nb_pois, categories: merged.categories });
          return merged;
        }
        // Ajouter à l'état existant
        let result = { ...prev };
        const existingIds = new Set(prev.pois.map((p: any) => p.id));
        for (const zoneResult of zonePoiResults) {
          const newPois = zoneResult.pois.filter((p: any) => !existingIds.has(p.id));
          newPois.forEach(p => existingIds.add(p.id));
          result = {
            ...result,
            pois: [...result.pois, ...newPois],
            categories: { ...result.categories, ...zoneResult.categories },
            couleur_overrides: { ...result.couleur_overrides, ...zoneResult.couleur_overrides },
          };
        }
        result.nb_pois = result.pois.length;
        console.log('[useToolProcessor] MERGED (appended):', { nb_pois: result.nb_pois, categories: result.categories });
        return result;
      });
    } else {
      console.log('[useToolProcessor] No zone results to fuse');
    }

    // ── Appliquer tous les isochrones accumulés ──
    if (isochronesToApply.length > 0) {
      console.log('[useToolProcessor] Applying', isochronesToApply.length, 'isochrones');
      isochronesToApply.forEach(iso => applyIsochrones(iso));
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
}
