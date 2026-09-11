import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// service_role requis pour les RPCs de tiles (bypass RLS intentionnel)
function getSupabase() {
  return createAdminClient();
}

export const dynamic = 'force-dynamic';

// ── Cache mémoire serveur ────────────────────────────────────────────────────
// Évite les appels Supabase redondants (tiles identiques, requêtes simultanées)
// En dev : persist tant que le serveur tourne. En prod serverless : par instance.
const tileMemCache = new Map<string, { buf: Buffer; expires: number }>();
const pendingTiles = new Map<string, Promise<Buffer | null>>();
const CACHE_TTL_MS  = 60 * 60 * 1000; // 1h
const MAX_CACHE     = 1000;            // tuiles max en mémoire

function pruneCacheIfNeeded() {
  if (tileMemCache.size <= MAX_CACHE) return;
  const toDelete = Math.floor(MAX_CACHE * 0.2);
  let i = 0;
  for (const k of tileMemCache.keys()) {
    tileMemCache.delete(k);
    if (++i >= toDelete) break;
  }
}

async function fetchTileBuffer(zoom: number, tileX: number, tileY: number): Promise<Buffer | null> {
  const { data, error } = await getSupabase().rpc('get_tile', { z: zoom, x: tileX, y: tileY });

  if (error) {
    console.error(`[tiles] ${zoom}/${tileX}/${tileY} error:`, error.message);
    return null;
  }

  const rawStr = String(data);
  const buffer = rawStr.startsWith('\\x')
    ? Buffer.from(rawStr.slice(2), 'hex')
    : Buffer.from(rawStr, 'base64');

  return buffer.length > 0 ? buffer : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params;

  const zoom  = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY)) {
    return new NextResponse('Invalid tile coordinates', { status: 400 });
  }

  // Borne basse alignee sur la cascade de get_tile (sql/127), qui sert le palier
  // 20 km jusqu'a z4. Elle valait 6 : les tuiles des bas zooms etaient refusees
  // en 204 cote serveur, en plus du minzoom 6 cote MapLibre — le verrou etait a
  // trois endroits (source, couche, route).
  if (zoom < 4) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const v   = req.nextUrl.searchParams.get('v') ?? '0';
  const key = `${v}/${zoom}/${tileX}/${tileY}`;
  const now = Date.now();

  // 1. Cache mémoire hit
  const cached = tileMemCache.get(key);
  if (cached && now < cached.expires) {
    return new NextResponse(cached.buf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=3600',
        'X-Tile-Cache': 'HIT',
        'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://genesis.vercel.app',
      },
    });
  }

  // 2. Déduplication des requêtes simultanées pour le même tile
  let pending = pendingTiles.get(key);
  if (!pending) {
    pending = fetchTileBuffer(zoom, tileX, tileY).finally(() => {
      pendingTiles.delete(key);
    });
    pendingTiles.set(key, pending);
  }

  const buffer = await pending;

  if (!buffer) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  // 3. Stocker en mémoire
  pruneCacheIfNeeded();
  tileMemCache.set(key, { buf: buffer, expires: now + CACHE_TTL_MS });

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Cache-Control': 'public, max-age=3600',
      'X-Tile-Cache': 'MISS',
      'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://genesis.vercel.app',
    },
  });
}
