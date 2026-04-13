'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

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
  fetchMap: (campaignId: string, scale: string, popField?: string, media?: string[], metric?: 'impressions' | 'unique', geographySetId?: string | null) => Promise<void>;
}

export function useDigitalData(): DigitalData {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geojsonLoading, setGeojsonLoading] = useState(false);
  const [geographySummary, setGeographySummary] = useState<GeographySummary | null>(null);
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

  return { campaigns, campaignsLoading, geojson, geojsonLoading, geographySummary, fetchMap };
}
