'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { MeteoParams, MeteoMeta } from '@/lib/meteo/types';

export const METEO_SENTINEL = 'meteo' as const;

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

interface DigitalData {
  campaigns: Campaign[];
  campaignsLoading: boolean;
  geojson: GeoJSON.FeatureCollection | null;
  geojsonLoading: boolean;
  geographySummary: GeographySummary | null;
  meteoMeta: MeteoMeta | null;
  fetchMap: (
    campaignId: string,
    scale: string,
    popField?: string,
    media?: string[],
    metric?: 'impressions' | 'unique',
    geographySetId?: string | null,
    meteoParams?: MeteoParams | null,
  ) => Promise<void>;
}

export function useDigitalData(): DigitalData {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geojsonLoading, setGeojsonLoading] = useState(false);
  const [geographySummary, setGeographySummary] = useState<GeographySummary | null>(null);
  const [meteoMeta, setMeteoMeta] = useState<MeteoMeta | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    meteoParams?: MeteoParams | null,
  ) => {
    if (!campaignId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGeojsonLoading(true);
    try {
      const pf = popField || 'population';
      const m = metric === 'unique' ? 'unique' : 'impressions';

      // Mode "Zones Meteo" : sentinel virtuel, endpoint dedie
      if (scale === 'zones' && geographySetId === METEO_SENTINEL) {
        console.log('[digital-data] fetchMap scale=zones sentinel=meteo params=', meteoParams);
        if (!meteoParams) {
          setGeojson({ type: 'FeatureCollection', features: [] });
          setGeographySummary(null);
          setMeteoMeta(null);
          return;
        }
        const p = new URLSearchParams({
          variable: meteoParams.variable,
          startDate: meteoParams.startDate,
          endDate: meteoParams.endDate,
          popField: pf,
          metric: m,
        });
        if (meteoParams.resolution !== undefined) {
          p.set('resolution', String(meteoParams.resolution));
        }
        const url = `/api/digital/${campaignId}/meteo?${p.toString()}`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status} ${txt}`);
        }
        const data = await res.json() as {
          geojson: GeoJSON.FeatureCollection;
          summary: GeographySummary | null;
          meta: MeteoMeta | null;
        };
        console.log('[digital-data] meteo features=', data.geojson?.features?.length, 'pct_in_zone=', data.summary?.pct_in_zone);
        setGeojson(data.geojson);
        setGeographySummary(data.summary);
        setMeteoMeta(data.meta);
        return;
      }

      // Mode "Zones" classique : appel de l'endpoint dedie geography
      if (scale === 'zones') {
        console.log('[digital-data] fetchMap scale=zones setId=', geographySetId);
        setMeteoMeta(null);
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
      setMeteoMeta(null);
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

  return { campaigns, campaignsLoading, geojson, geojsonLoading, geographySummary, meteoMeta, fetchMap };
}
