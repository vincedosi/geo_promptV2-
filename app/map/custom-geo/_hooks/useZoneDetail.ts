import { useState, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { CustomGeoZoneFull, CustomGeoZoneGeometry } from '@/types/custom-geo';

export function useZoneDetail(zoneId: string | null) {
  const [zone, setZone] = useState<CustomGeoZoneFull | null>(null);
  const [geometry, setGeometry] = useState<CustomGeoZoneGeometry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!zoneId) { setZone(null); setGeometry(null); return; }
    setLoading(true);
    setError(null);

    Promise.all([
      adminFetch(`/api/custom-geo/${zoneId}`).then(r => r.ok ? r.json() : null),
      adminFetch(`/api/custom-geo/${zoneId}/geometry`).then(r => r.ok ? r.json() : null),
    ])
      .then(([z, g]) => {
        setZone(z);
        setGeometry(g);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Erreur');
      })
      .finally(() => setLoading(false));
  }, [zoneId]);

  return { zone, geometry, loading, error };
}
