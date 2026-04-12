'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Campaign {
  id: string; name: string; total_tracked_ads: number;
  dsp_source: string; date_start: string | null; date_end: string | null;
  nb_medias: number; nb_postal_codes: number;
}

interface DigitalData {
  campaigns: Campaign[];
  campaignsLoading: boolean;
  geojson: GeoJSON.FeatureCollection | null;
  geojsonLoading: boolean;
  fetchMap: (campaignId: string, scale: string, popField?: string, media?: string[]) => Promise<void>;
}

export function useDigitalData(): DigitalData {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geojsonLoading, setGeojsonLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch(`/api/digital/campaigns?_t=${Date.now()}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setCampaigns(data))
      .catch(() => {})
      .finally(() => setCampaignsLoading(false));
  }, []);

  const fetchMap = useCallback(async (campaignId: string, scale: string, popField?: string, media?: string[]) => {
    if (!campaignId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGeojsonLoading(true);
    try {
      const pf = popField || 'population';
      let url = `/api/digital/${campaignId}/map?bbox=-5.5,41.0,10.0,51.5&scale=${scale}&pop_field=${pf}`;
      if (media && media.length > 0) url += `&media=${media.join(',')}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fc = await res.json() as GeoJSON.FeatureCollection;
      setGeojson(fc);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error('[digital-data]', err);
    } finally {
      setGeojsonLoading(false);
    }
  }, []);

  return { campaigns, campaignsLoading, geojson, geojsonLoading, fetchMap };
}
