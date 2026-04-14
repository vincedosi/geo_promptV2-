'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { MeteoParams, MeteoMeta } from '@/lib/meteo/types';

interface Campaign {
  id: string; name: string; total_tracked_ads: number;
  total_unique_impressions: number;
  dsp_source: string; date_start: string | null; date_end: string | null;
  nb_medias: number; nb_postal_codes: number;
}

interface GeographySummary {
  in_zone_impressions: number;
  total_impressions: number;
  pct_in_zone: number;
  total_zones: number;
  zones_with_impressions: number;
}

export interface MeteoProgress {
  completed: number;
  total: number;
  cached: boolean;
}

interface DigitalData {
  campaigns: Campaign[];
  campaignsLoading: boolean;
  geojson: GeoJSON.FeatureCollection | null;
  geojsonLoading: boolean;
  geographySummary: GeographySummary | null;
  // Meteo state — independant de geojson, alimente uniquement la 3eme carte
  meteoGeojson: GeoJSON.FeatureCollection | null;
  meteoMeta: MeteoMeta | null;
  meteoLoading: boolean;
  meteoProgress: MeteoProgress | null;
  fetchMap: (
    campaignId: string,
    scale: string,
    popField?: string,
    media?: string[],
    metric?: 'impressions' | 'unique',
    geographySetId?: string | null,
  ) => Promise<void>;
  fetchMeteo: (campaignId: string, params: MeteoParams) => Promise<void>;
  clearMeteo: () => void;
}

export function useDigitalData(): DigitalData {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geojsonLoading, setGeojsonLoading] = useState(false);
  const [geographySummary, setGeographySummary] = useState<GeographySummary | null>(null);
  const [meteoGeojson, setMeteoGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [meteoMeta, setMeteoMeta] = useState<MeteoMeta | null>(null);
  const [meteoLoading, setMeteoLoading] = useState(false);
  const [meteoProgress, setMeteoProgress] = useState<MeteoProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const meteoAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch(`/api/digital/campaigns?_t=${Date.now()}`)
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
    metric?: 'impressions' | 'unique',
    geographySetId?: string | null,
  ) => {
    if (!campaignId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGeojsonLoading(true);
    try {
      const pf = popField || 'population';
      const m = metric === 'unique' ? 'unique' : 'impressions';

      // Mode "Zones" : appel de l'endpoint dedie geography
      if (scale === 'zones') {
        console.log('[digital-data] fetchMap scale=zones setId=', geographySetId);
        if (!geographySetId) {
          setGeojson({ type: 'FeatureCollection', features: [] });
          setGeographySummary(null);
          return;
        }
        const url = `/api/digital/${campaignId}/geography/${geographySetId}?pop_field=${pf}&metric=${m}`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status} ${txt}`);
        }
        const data = await res.json() as { geojson: GeoJSON.FeatureCollection; summary: GeographySummary | null };
        console.log('[digital-data] zones features=', data.geojson?.features?.length, 'pct_in_zone=', data.summary?.pct_in_zone);
        setGeojson(data.geojson);
        setGeographySummary(data.summary);
        return;
      }

      setGeographySummary(null);
      let url = `/api/digital/${campaignId}/map?bbox=-5.5,41.0,10.0,51.5&scale=${scale}&pop_field=${pf}&metric=${m}`;
      if (media && media.length > 0) url += `&media=${media.join(',')}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fc = await res.json() as GeoJSON.FeatureCollection;
      setGeojson(fc);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[digital-data]', err);
        // Clear stale data on error so user sees empty, not old region polygons
        setGeojson({ type: 'FeatureCollection', features: [] });
      }
    } finally {
      setGeojsonLoading(false);
    }
  }, []);

  // Fetch meteo grid — SSE streaming avec progression par batch Open-Meteo.
  // Cache hit = done immédiat. Cache miss = progress events puis done.
  const fetchMeteo = useCallback(async (campaignId: string, params: MeteoParams) => {
    if (!campaignId) return;
    meteoAbortRef.current?.abort();
    const ctrl = new AbortController();
    meteoAbortRef.current = ctrl;
    setMeteoLoading(true);
    setMeteoProgress(null);
    try {
      const p = new URLSearchParams({
        variable: params.variable,
        startDate: params.startDate,
        endDate: params.endDate,
      });
      if (params.resolution !== undefined) p.set('resolution', String(params.resolution));
      const url = `/api/digital/${campaignId}/meteo?${p.toString()}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalPoints = 0;
      let isCached = false;
      let doneReceived = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split by double newline (SSE event delimiter)
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          // Extract data: lines
          const lines = rawEvent.split('\n').filter((l) => l.startsWith('data: '));
          if (lines.length === 0) continue;
          const payload = lines.map((l) => l.slice(6)).join('');
          if (!payload) continue;

          let evt: unknown;
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }

          const e = evt as { type: string } & Record<string, unknown>;
          if (e.type === 'init') {
            totalPoints = (e.total as number) ?? 0;
            isCached = (e.cached as boolean) ?? false;
            setMeteoProgress({ completed: 0, total: totalPoints, cached: isCached });
          } else if (e.type === 'progress') {
            setMeteoProgress({
              completed: (e.completed as number) ?? 0,
              total: (e.total as number) ?? totalPoints,
              cached: isCached,
            });
          } else if (e.type === 'done') {
            const geojson = e.geojson as GeoJSON.FeatureCollection;
            const meta = (e.meta as MeteoMeta | null) ?? null;
            const cached = (e.cached as boolean) ?? false;
            console.log(
              '[digital-data] meteo done features=',
              geojson?.features?.length,
              'cached=',
              cached,
            );
            setMeteoGeojson(geojson);
            setMeteoMeta(meta);
            doneReceived = true;
          } else if (e.type === 'error') {
            throw new Error((e.message as string) ?? 'meteo stream error');
          }
        }
      }

      if (!doneReceived) {
        throw new Error('meteo stream ended without done event');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[digital-data] meteo', err);
        setMeteoGeojson({ type: 'FeatureCollection', features: [] });
        setMeteoMeta(null);
      }
    } finally {
      setMeteoLoading(false);
      setMeteoProgress(null);
    }
  }, []);

  const clearMeteo = useCallback(() => {
    meteoAbortRef.current?.abort();
    setMeteoGeojson(null);
    setMeteoMeta(null);
    setMeteoLoading(false);
    setMeteoProgress(null);
  }, []);

  return {
    campaigns, campaignsLoading,
    geojson, geojsonLoading, geographySummary,
    meteoGeojson, meteoMeta, meteoLoading, meteoProgress,
    fetchMap, fetchMeteo, clearMeteo,
  };
}
