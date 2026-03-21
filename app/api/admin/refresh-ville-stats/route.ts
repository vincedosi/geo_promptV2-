/**
 * app/api/admin/refresh-ville-stats/route.ts
 * Lance le calcul du cache smart_ville_stats (long-running, ~2-3 min).
 * Appelle refresh_smart_ville_stats() via service role (pas de timeout HTTP court).
 */

import { createAdminClient } from '@/lib/auth';
import { NextResponse }      from 'next/server';

export const maxDuration = 300; // Vercel Pro : 5 min max

export async function POST() {
  const sb = createAdminClient();

  console.log('[refresh-ville-stats] start');
  const t0 = Date.now();

  const { error } = await sb.rpc('refresh_smart_ville_stats');

  if (error) {
    console.error('[refresh-ville-stats] error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log('[refresh-ville-stats] done in', elapsed, 's');

  // Vérifier combien de lignes ont été insérées
  const { count } = await sb.from('smart_ville_stats').select('*', { count: 'exact', head: true });

  return NextResponse.json({ ok: true, elapsed_s: elapsed, rows: count });
}
