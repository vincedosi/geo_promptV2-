'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

export interface AdminCustomZone {
  id: string;
  name: string;
  description: string | null;
  org_id: string;
  org_name: string | null;
  source_type: string;
  source_metadata: Record<string, unknown>;
  feature_count_iris: number;
  feature_count_cp: number;
  bbox: [number, number, number, number] | null;
  created_at: string;
  created_by: string | null;
}

interface UseAdminCustomZonesParams {
  orgId: string | null;
  sourceType: string | null;
  searchQuery: string;
  enabled?: boolean;
}

export function useAdminCustomZones({ orgId, sourceType, searchQuery, enabled = true }: UseAdminCustomZonesParams) {
  const [zones, setZones] = useState<AdminCustomZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchZones = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (orgId) sp.set('org_id', orgId);
      if (sourceType) sp.set('source_type', sourceType);
      if (searchQuery) sp.set('q', searchQuery);
      const res = await adminFetch(`/api/admin/custom-geo/list?${sp}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setZones(Array.isArray(data.zones) ? data.zones : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [orgId, sourceType, searchQuery, enabled]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchZones, searchQuery ? 200 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [fetchZones, searchQuery]);

  const remove = useCallback(async (zoneId: string) => {
    const res = await adminFetch(`/api/admin/custom-geo/${zoneId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Erreur' }));
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    setZones(prev => prev.filter(z => z.id !== zoneId));
  }, []);

  return { zones, loading, error, refetch: fetchZones, remove };
}
