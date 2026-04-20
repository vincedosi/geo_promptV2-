'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

export interface AdminCustomGeoStats {
  total_zones: number;
  total_iris: number;
  total_cp: number;
  nb_workspaces: number;
  top_workspaces: Array<{ org_id: string; org_name: string | null; nb_zones: number }>;
}

export function useAdminCustomZonesStats(enabled: boolean = true) {
  const [stats, setStats] = useState<AdminCustomGeoStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/custom-geo/stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStats(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
}
