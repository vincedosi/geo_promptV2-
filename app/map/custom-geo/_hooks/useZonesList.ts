import { useState, useEffect, useCallback, useRef } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { CustomGeoZoneSummary } from '@/types/custom-geo';

export function useZonesList(params: {
  orgId: string;
  sourceType?: string | null;
  searchQuery?: string;
}) {
  const [zones, setZones] = useState<CustomGeoZoneSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchZones = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ org_id: params.orgId });
      if (params.sourceType) sp.set('source_type', params.sourceType);
      if (params.searchQuery) sp.set('q', params.searchQuery);
      // Cache-buster timestamp + cache: 'no-store' — court-circuite TOUS les
      // caches (navigateur, Service Worker, wrapper fetch Next.js).
      sp.set('_t', String(Date.now()));
      const res = await adminFetch(`/api/custom-geo/list?${sp}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setZones(data.zones ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [params.orgId, params.sourceType, params.searchQuery]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchZones, params.searchQuery ? 200 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [fetchZones, params.searchQuery]);

  // Refetch au retour de focus (user revient sur l'onglet → liste à jour)
  useEffect(() => {
    const onFocus = () => fetchZones();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchZones]);

  return { zones, loading, error, refetch: fetchZones };
}
