import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

interface ZonesStats {
  total: number;
  total_iris: number;
  total_cp: number;
  most_recent_at: string | null;
  by_source_type: Array<{ source_type: string; count: number }>;
}

export function useZonesStats(orgId: string) {
  const [stats, setStats] = useState<ZonesStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/custom-geo/stats?org_id=${orgId}&_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  // Refresh au retour de focus pour rester en phase avec la liste
  useEffect(() => {
    const onFocus = () => fetch_();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetch_]);

  return { stats, loading, refetch: fetch_ };
}
