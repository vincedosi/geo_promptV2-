/**
 * GET /api/tmja-tiles/[z]/[x]/[y]
 *
 * Tuiles MVT pour les flux routiers TMJA (table comptages_routiers).
 * Pipeline calqué sur /api/tiles/[z]/[x]/[y] (carreaux Filosofi) :
 *   - RPC PostGIS get_tmja_tile(z, x, y) → bytea ST_AsMVT
 *   - Cache mémoire serveur 1h (LRU 1000 tiles)
 *   - Déduplication des requêtes simultanées
 *   - Headers Cache-Control + CORS
 *
 * Filtre TMJA adaptatif côté SQL : au low-zoom, on ne renvoie que les axes
 * majeurs (autoroutes/nationales), au high-zoom on densifie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

function getSupabase() {
  return createAdminClient();
}

export const dynamic = 'force-dynamic';

const tileMemCache = new Map<string, { buf: Buffer; expires: number }>();
const pendingTiles = new Map<string, Promise<Buffer | null>>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE = 1000;

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
  const { data, error } = await getSupabase().rpc('get_tmja_tile', { z: zoom, x: tileX, y: tileY });
  if (error) {
    console.error(`[tmja-tiles] ${zoom}/${tileX}/${tileY} error:`, error.message);
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
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await params;
  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY)) {
    return new NextResponse('Invalid tile coordinates', { status: 400 });
  }

  // En dessous de zoom 6, on n'affiche pas — économise des appels DB inutiles
  if (zoom < 6) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const v = req.nextUrl.searchParams.get('v') ?? '0';
  const key = `${v}/${zoom}/${tileX}/${tileY}`;
  const now = Date.now();

  const cached = tileMemCache.get(key);
  if (cached && now < cached.expires) {
    return new NextResponse(cached.buf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Tile-Cache': 'HIT',
        'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://genesis.vercel.app',
      },
    });
  }

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
