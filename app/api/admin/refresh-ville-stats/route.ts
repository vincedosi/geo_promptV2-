/**
 * app/api/admin/refresh-ville-stats/route.ts
 * Peuple smart_ville_stats chunk par chunk (5 villes/chunk).
 * POST ?chunk=N pour traiter le chunk N (appelé en boucle depuis le client).
 * POST sans param → lance tous les chunks séquentiellement.
 */

import { createAdminClient } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const maxDuration = 60;

const TOTAL_CITIES = 300;
const CHUNK_SIZE   = 5;
const TOTAL_CHUNKS = Math.ceil(TOTAL_CITIES / CHUNK_SIZE);

export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { searchParams } = new URL(req.url);
  const chunkParam = searchParams.get('chunk');

  // Mode chunk unique : POST ?chunk=N
  if (chunkParam !== null) {
    const chunk  = parseInt(chunkParam, 10);
    const offset = chunk * CHUNK_SIZE;

    const { data, error } = await sb.rpc('refresh_ville_stats_chunk', {
      p_offset: offset,
      p_limit:  CHUNK_SIZE,
    });

    if (error) {
      return NextResponse.json({ ok: false, chunk, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, chunk, inserted: data as number });
  }

  // Mode full : vider le cache + retourner le nb de chunks à traiter
  await sb.from('smart_ville_stats').delete().gte('total', 0);

  return NextResponse.json({ ok: true, total_chunks: TOTAL_CHUNKS, chunk_size: CHUNK_SIZE });
}

export async function GET() {
  const sb = createAdminClient();
  const { count } = await sb.from('smart_ville_stats').select('*', { count: 'exact', head: true });
  return NextResponse.json({ rows: count, total_chunks: TOTAL_CHUNKS });
}
