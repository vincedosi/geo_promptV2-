'use client';

import { useEffect, useState } from 'react';

/**
 * Source unique des régions / départements INSEE depuis la DB (ref_regions
 * + ref_departements via /api/ref/geo). Remplace lib/geo/france-admin.ts
 * pour toute opération qui envoie des codes INSEE à Supabase (notamment
 * territory-mask, admin_scope pour la capture).
 *
 * Cache module-level (partagé entre toutes les instances du hook) :
 *   - Données stables (codes INSEE régions changent à peine 1x/10 ans)
 *   - 1 fetch réseau au 1er mount, puis tous les autres useRefGeo() lisent
 *     la valeur cachée en synchrone
 *   - La route API a aussi un Cache-Control 1h public côté HTTP
 */

export interface RefDept {
  code_dept: string;   // '75', '35', '2A', ...
  nom_dept:  string;
}
export interface RefRegion {
  code_region: string; // INSEE : '11', '53', '76', '84', ...
  nom_region:  string;
  depts:       RefDept[];
}
export interface RefGeo {
  regions: RefRegion[];
}

let cache:  RefGeo | null = null;
let inflight: Promise<RefGeo> | null = null;

async function fetchRefGeo(): Promise<RefGeo> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch('/api/ref/geo', { credentials: 'include' })
    .then(async res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as RefGeo;
      cache = data;
      return data;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useRefGeo(): {
  data: RefGeo | null;
  loading: boolean;
  error: Error | null;
  /** Liste aplatie des départements (tri par code_dept) */
  allDepts: RefDept[];
} {
  const [data,    setData]    = useState<RefGeo | null>(cache);
  const [loading, setLoading] = useState<boolean>(!cache);
  const [error,   setError]   = useState<Error | null>(null);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    fetchRefGeo()
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e : new Error(String(e))); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const allDepts: RefDept[] = data
    ? data.regions
        .flatMap(r => r.depts)
        .sort((a, b) => a.code_dept.localeCompare(b.code_dept))
    : [];

  return { data, loading, error, allDepts };
}
