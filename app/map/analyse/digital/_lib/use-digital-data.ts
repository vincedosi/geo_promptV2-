'use client';
import { logger } from '@/lib/logger';

import { adminFetch } from '@/lib/admin-fetch';
import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  MeteoParams,
  MeteoScale,
  MeteoZoneChunk,
  MeteoZoneMeta,
  MeteoZoneValue,
} from '@/lib/meteo/types';

interface Campaign {
  id: string; name: string; total_tracked_ads: number;
  total_unique_impressions: number;
  dsp_source: string; date_start: string | null; date_end: string | null;
  nb_medias: number; nb_postal_codes: number;
  /** Correction manuelle du statut de cycle de vie (paused/ended/archived), ou null si aucune. */
  status_override: 'paused' | 'ended' | 'archived' | null;
  /** Date de la dernière ligne de données importée (signal d'attention). */
  last_data_date: string | null;
}

interface CustomZoneSummary {
  in_zone_impressions: number;
  total_impressions: number;
  pct_in_zone: number;
  total_zones: number;
  zones_with_impressions: number;
}

export interface MeteoProgress {
  current: number;
  total: number;
  etaMs?: number;
}

interface DigitalData {
  campaigns: Campaign[];
  campaignsLoading: boolean;
  geojson: GeoJSON.FeatureCollection | null;
  geojsonLoading: boolean;
  customZoneSummary: CustomZoneSummary | null;
  // Meteo state — data = mapping code_zone → valeur météo
  // Les 3 cartes réutilisent `geojson` (memes polygones), la 3eme carte enrichit
  // chaque feature avec meteo_value via le lookup sur ce Record.
  meteoData: Record<string, MeteoZoneValue> | null;
  meteoMeta: MeteoZoneMeta | null;
  meteoLoading: boolean;
  meteoProgress: MeteoProgress | null;
  meteoError: string | null;
  fetchMap: (
    campaignId: string,
    scale: string,
    popField?: string,
    media?: string[],
    metric?: string,
    customZoneId?: string | null,
  ) => Promise<void>;
  fetchMeteo: (scale: MeteoScale, params: MeteoParams) => Promise<void>;
  clearMeteo: () => void;
}

export function useDigitalData(): DigitalData {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geojsonLoading, setGeojsonLoading] = useState(false);
  const [customZoneSummary, setCustomZoneSummary] = useState<CustomZoneSummary | null>(null);
  const [meteoData, setMeteoData] = useState<Record<string, MeteoZoneValue> | null>(null);
  const [meteoMeta, setMeteoMeta] = useState<MeteoZoneMeta | null>(null);
  const [meteoLoading, setMeteoLoading] = useState(false);
  const [meteoProgress, setMeteoProgress] = useState<MeteoProgress | null>(null);
  const [meteoError, setMeteoError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const meteoAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    adminFetch(`/api/digital/campaigns?_t=${Date.now()}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setCampaigns(data))
      .catch(() => {})
      .finally(() => setCampaignsLoading(false));
  }, []);

  const fetchMap = useCallback(async (
    campaignId: string,
    scale: string,
    popField?: string,
    media?: string[],
    metric?: string,
    customZoneId?: string | null,
  ) => {
    if (!campaignId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGeojsonLoading(true);
    try {
      const pf = popField || 'population';
      // metric peut être : un alias legacy ('impressions'/'unique') OU un
      // field de dsp_metrics_registry (tracked_ads, impressions, clicks, leads...).
      // La route API /api/digital/[id]/map résout le bon field selon le DSP
      // (Adform alias 'impressions' → tracked_ads ; TTD impressions = colonne native).
      const m = metric ? encodeURIComponent(metric) : 'impressions';

      // Mode "Zones personnalisees" (galerie /map/custom-geo)
      if (scale === 'custom_zone') {
        logger.debug('digital-data', `fetchMap scale=custom_zone zoneId= ${customZoneId}`);
        if (!customZoneId) {
          setGeojson({ type: 'FeatureCollection', features: [] });
          setCustomZoneSummary(null);
          return;
        }
        const url = `/api/digital/${campaignId}/custom-zone/${customZoneId}?pop_field=${pf}&metric=${m}`;
        const res = await adminFetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status} ${txt}`);
        }
        const data = await res.json() as { geojson: GeoJSON.FeatureCollection; summary: CustomZoneSummary | null };
        logger.debug('digital-data', `custom_zone features= ${data.geojson?.features?.length} pct_in_zone= ${data.summary?.pct_in_zone}`);
        setGeojson(data.geojson);
        setCustomZoneSummary(data.summary);
        return;
      }

      setCustomZoneSummary(null);
      let url = `/api/digital/${campaignId}/map?bbox=-5.5,41.0,10.0,51.5&scale=${scale}&pop_field=${pf}&metric=${m}`;
      if (media && media.length > 0) url += `&media=${media.join(',')}`;
      const res = await adminFetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fc = await res.json() as GeoJSON.FeatureCollection;
      setGeojson(fc);
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[digital-data]', err);
        // Clear stale data on error so user sees empty, not old region polygons
        setGeojson({ type: 'FeatureCollection', features: [] });
      }
    } finally {
      setGeojsonLoading(false);
    }
  }, []);

  // Fetch meteo par zones admin (centroïdes). Stream NDJSON pour progression.
  const fetchMeteo = useCallback(async (scale: MeteoScale, params: MeteoParams) => {
    meteoAbortRef.current?.abort();
    const ctrl = new AbortController();
    meteoAbortRef.current = ctrl;
    setMeteoLoading(true);
    setMeteoProgress(null);
    setMeteoError(null);
    try {
      const url =
        `/api/meteo-geo?scale=${scale}` +
        `&variable=${params.variable}` +
        `&startDate=${params.startDate}` +
        `&endDate=${params.endDate}`;
      const res = await adminFetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let chunk: MeteoZoneChunk;
          try {
            chunk = JSON.parse(trimmed) as MeteoZoneChunk;
          } catch {
            console.warn('[digital-data] meteo parse error', trimmed.slice(0, 100));
            continue;
          }

          if (chunk.status === 'fetching') {
            setMeteoProgress({ current: chunk.progress, total: chunk.total, etaMs: chunk.etaMs });
          } else if (chunk.status === 'done') {
            setMeteoData(chunk.data);
            setMeteoMeta(chunk.meta);
            setMeteoProgress(null);
            logger.debug('digital-data', `meteo done zones= ${Object.keys(chunk.data).length} variable= ${chunk.meta.variable} cached= ${chunk.meta.cachedAt !== null}`);
          } else if (chunk.status === 'error') {
            throw new Error(chunk.error);
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue';
        console.error('[digital-data] meteo', msg);
        setMeteoError(msg);
        setMeteoData(null);
        setMeteoMeta(null);
      }
    } finally {
      setMeteoLoading(false);
      setMeteoProgress(null);
    }
  }, []);

  const clearMeteo = useCallback(() => {
    meteoAbortRef.current?.abort();
    setMeteoData(null);
    setMeteoMeta(null);
    setMeteoLoading(false);
    setMeteoProgress(null);
    setMeteoError(null);
  }, []);

  return {
    campaigns, campaignsLoading,
    geojson, geojsonLoading, customZoneSummary,
    meteoData, meteoMeta, meteoLoading, meteoProgress, meteoError,
    fetchMap, fetchMeteo, clearMeteo,
  };
}
