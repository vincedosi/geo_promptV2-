import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Cache mémoire (1h, max 2000 tuiles)
const cache = new Map<string, { buf: Buffer; ts: number }>();
const CACHE_TTL = 3_600_000;
const CACHE_MAX = 2000;

export async function GET(
  _req: NextRequest,
  { params }: { params: { z: string; x: string; y: string } }
) {
  const z = parseInt(params.z, 10);
  const x = parseInt(params.x, 10);
  const y = parseInt(params.y, 10);

  if ([z, x, y].some(isNaN)) {
    return new Response('Coordonnées invalides', { status: 400 });
  }

  if (z < 1) return new Response(null, { status: 204 });

  const v   = _req.nextUrl.searchParams.get('v') ?? '1';
  const key = `${v}/${z}/${x}/${y}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    if (cached.buf.length === 0) return new Response(null, { status: 204 });
    return new Response(cached.buf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_iris_tile', { z, x, y });

  if (error) {
    console.error('[iris-tiles] RPC error:', error.message);
    return new Response('Erreur serveur', { status: 500 });
  }

  // Supabase renvoie bytea sous forme hex avec préfixe \x (ex: \x1f8b...)
  let buf = Buffer.alloc(0);
  if (data) {
    const rawStr = String(data);
    buf = rawStr.startsWith('\\x')
      ? Buffer.from(rawStr.slice(2), 'hex')
      : Buffer.from(rawStr, 'base64');
  }

  // LRU simple : supprimer la plus ancienne si cache plein
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    cache.delete(oldest[0]);
  }
  cache.set(key, { buf, ts: Date.now() });

  if (buf.length === 0) return new Response(null, { status: 204 });

  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
