import { useState, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

export function useSourceTypes(orgId: string) {
  const [sourceTypes, setSourceTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    adminFetch(`/api/custom-geo/source-types?org_id=${orgId}`)
      .then(r => r.ok ? r.json() : { source_types: [] })
      .then(data => setSourceTypes(data.source_types ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  return { sourceTypes, loading };
}
