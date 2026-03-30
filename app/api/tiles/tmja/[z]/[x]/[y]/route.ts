import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const dynamic = 'force-dynamic';

// ── Cache mémoire serveur (même pattern que /api/tiles/[z]/[x]/[y]) ──────────
const tileMemCache = new Map<string, { buf: Buffer; expires: number }>();
const pendingTiles = new Map<string, Promise<Buffer | null>>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — TMJA quasi-statique
const MAX_CACHE    = 2000;            // tiles max en mémoire

function pruneCacheIfNeeded() {
  if (tileMemCache.size <= MAX_CACHE) return;
  const toDelete = Math.floor(MAX_CACHE * 0.2);
  let i = 0;
  for (const k of tileMemCache.keys()) {
    tileMemCache.delete(k);
    if (++i >= toDelete) break;
  }
}

async function fetchTileBuffer(z: number, x: number, y: number): Promise<Buffer | null> {
  const { data, error } = await getSupabase().rpc('get_tile_tmja', { z, x, y });

  if (error) {
    console.error(`[tiles/tmja] ${z}/${x}/${y} error:`, error.message);
    return null;
  }

  const rawStr = String(data);
  const buffer = rawStr.startsWith('\\x')
    ? Buffer.from(rawStr.slice(2), 'hex')
    : Buffer.from(rawStr, 'base64');

  return buffer.length > 0 ? buffer : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params;

  const zoom  = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY)) {
    return new NextResponse('Invalid tile coordinates', { status: 400 });
  }

  // Zoom minimum 8 — en dessous le réseau routier est illisible et la requête trop lourde
  if (zoom < 8) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const key = `${zoom}/${tileX}/${tileY}`;
  const now = Date.now();

  // 1. Cache mémoire hit
  const cached = tileMemCache.get(key);
  if (cached && now < cached.expires) {
    return new NextResponse(cached.buf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=3600',
        'X-Tile-Cache': 'HIT',
        'Access-Control-Allow-Origin': '*',
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
      'Access-Control-Allow-Origin': '*',
    },
  });
}
