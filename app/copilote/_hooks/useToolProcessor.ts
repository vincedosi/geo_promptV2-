'use client';

import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { ZoneData, IsochroneData, VoronoiData, CarreauxData } from '@/types/spatial';
import type { OohExportData } from '../_lib/ooh-export';

export interface CorrelationActionParams {
  mode?:        'iris_poi' | 'iris_iris';
  poiCategory?: string;
  irisMetric?:  string;
  sigmaKm?:     number;
  metricX?:     string;
  metricY?:     string;
  departement:  string | null;
  autoAnalyse:  boolean;
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
  triggerOohExport: (data: OohExportData) => Promise<void>;
  setCorrelationParams?: (p: CorrelationActionParams) => void;
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
  triggerOohExport,
  setCorrelationParams,
}: UseToolProcessorOpts) {
  const processedToolIds = useRef(new Set<string>());

  useEffect(() => {
    // Accumule les résultats analyser_zone_pois pour éviter le batching race condition
    const zonePoiResults: ZoneData[] = [];
    const isochronesToApply: IsochroneData[] = [];

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;

      for (let partIdx = 0; partIdx < (msg.parts ?? []).length; partIdx++) {
        const p = (msg.parts as any[])[partIdx];

        if (p.state !== 'output-available') continue;
        if (!p.type?.startsWith('tool-')) continue;

        // Clé robuste : toolCallId si dispo, sinon msgId+index
        const key = p.toolCallId ?? `${msg.id}:${partIdx}`;
        if (processedToolIds.current.has(key)) continue;
        processedToolIds.current.add(key);

        const toolName = (p.type as string).replace(/^tool-/, '');
        const result   = p.output;

        if (toolName === 'analyser_zone_pois' && result?.coordonnees) {
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
          setZoneData(result as ZoneData);
          if (result.coordonnees) flyToCoords(result.coordonnees.lat, result.coordonnees.lng);

        } else if (toolName === 'scorer_panneaux_ooh' && result?.error) {
          setError(`📊 Score OOH — ${result.error}`);
        } else if (toolName === 'scorer_panneaux_ooh' && result?.pois) {
          // Upgrade les POIs top_ooh existants (catégorie → violet) et ajoute les nouveaux
          setZoneData(prev => {
            const topPois = (result as ZoneData).pois;
            const topIds = new Set(topPois.map((p: any) => p.id));
            if (!prev) return result as ZoneData;
            const updatedPois = prev.pois.map((p: any) =>
              topIds.has(p.id)
                ? { ...topPois.find((t: any) => t.id === p.id), categorie: 'top_ooh' }
                : p
            );
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
          setZoneData(result as ZoneData);
          if (result.coordonnees) flyToCoords(result.coordonnees.lat, result.coordonnees.lng);

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
            if (result.coordonnees) flyToCoords(result.coordonnees.lat, result.coordonnees.lng);
          }

        } else if (toolName === 'analyse_correlation' && result?.action === 'analyse_correlation') {
          setCorrelationParams?.({
            mode:        result.mode        ?? 'iris_poi',
            poiCategory: result.poiCategory,
            irisMetric:  result.irisMetric  ?? 'population',
            sigmaKm:     result.sigmaKm,
            metricX:     result.metricX,
            metricY:     result.metricY,
            departement: result.departement ?? null,
            autoAnalyse: result.autoAnalyse !== false,
          });

        } else if (toolName === 'analyse_complete' && result?.coordonnees) {
          flyToCoords(result.coordonnees.lat, result.coordonnees.lng);

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
          } else if (result.battleGeoJSON?.features?.length > 0) {
            applyIsochroneBattle(
              result.battleGeoJSON,
              result.battleBorders ?? null,
              result.category,
              result.poisForMap
            );
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
          return merged;
        }
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
        return result;
      });
    }

    if (isochronesToApply.length > 0) {
      isochronesToApply.forEach(iso => applyIsochrones(iso));
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
}
