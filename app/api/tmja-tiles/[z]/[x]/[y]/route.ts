/**
 * GET /api/tmja-tiles/[z]/[x]/[y]
 *
 * Tuiles MVT pour les flux routiers TMJA (table comptages_routiers).
 * Pipeline calqué sur /api/tiles/[z]/[x]/[y] (carreaux Filosofi) :
 *   - RPC PostGIS get_tmja_tile(z, x, y) → bytea ST_AsMVT
 *   - Gzip, obligatoire (MapLibre 5.x plante silencieusement sans). Mesure du
 *     2026-09-11 sur la tuile 10/518/351 (Paris) : 391 535 octets AVANT gzip.
 *     Le commentaire precedent annoncait « ~150 KB → ~35 KB » — 2,6 fois moins
 *     que la realite. Un chiffre faux dans un commentaire de performance est
 *     un piege pour qui s'y fiera plus tard pour arbitrer.
 *   - Cache CDN 1 semaine (s-maxage) — le cache mémoire par lambda est un
 *     bonus local, le vrai cache partagé est le CDN Vercel (?v= pour invalider)
 *   - Déduplication des requêtes simultanées
 *
 * Filtre TMJA adaptatif côté SQL : au low-zoom, on ne renvoie que les axes
 * majeurs (autoroutes/nationales), au high-zoom on densifie. Zoom 5 activé
 * (tier 1 uniquement) pour que les autoroutes soient visibles dès la vue France.
 */
import { NextRequest, NextResponse } from 'next/server';
import { gzipSync, gunzipSync } from 'zlib';
import { createAdminClient } from '@/lib/auth';
import {
  creerCacheTuiles,
  BUDGET_CACHE_TUILES_OCTETS,
  TTL_CACHE_TUILES_MS,
} from '@/lib/tiles/cache-lru';

function getSupabase() {
  return createAdminClient();
}

export const dynamic = 'force-dynamic';

// Cache partage, borne en OCTETS et evince par usage (lib/tiles/cache-lru.ts).
// L'ancien plafonnait a 1 000 ENTREES et purgeait les 200 premieres CLES
// INSEREES : il evincait donc une tuile tres demandee avant une tuile vue une
// seule fois, et ne bornait pas la memoire — une tuile pese de 101 ko a 827 ko.
const tileMemCache = creerCacheTuiles({
  budgetOctets: BUDGET_CACHE_TUILES_OCTETS,
  ttlMs: TTL_CACHE_TUILES_MS,
});
const pendingTiles = new Map<string, Promise<Buffer | null>>();

/** Renvoie la tuile MVT déjà gzippée (stockée gzippée en cache mémoire). */
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
  return buffer.length > 0 ? gzipSync(buffer) : null;
}

function tileHeaders(cacheStatus: 'HIT' | 'MISS', acceptsGzip: boolean): Record<string, string> {
  return {
    'Content-Type': 'application/vnd.mapbox-vector-tile',
    ...(acceptsGzip ? { 'Content-Encoding': 'gzip' } : {}),
    'Vary': 'Accept-Encoding',
    // Versionné par ?v= → immutable. s-maxage = cache CDN partagé entre users/lambdas.
    'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
    'X-Tile-Cache': cacheStatus,
    'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://genesis.vercel.app',
  };
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

  // En dessous de zoom 5, on n'affiche pas — économise des appels DB inutiles
  // (z5 = vue France : axes majeurs tier 1 uniquement, servis par le CDN)
  if (zoom < 5) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const acceptsGzip = (req.headers.get('accept-encoding') ?? '').includes('gzip');
  const v = req.nextUrl.searchParams.get('v') ?? '0';
  const key = `${v}/${zoom}/${tileX}/${tileY}`;

  const cached = tileMemCache.lire(key);
  if (cached) {
    const body = acceptsGzip ? cached : gunzipSync(cached);
    return new NextResponse(body as unknown as BodyInit, {
      headers: tileHeaders('HIT', acceptsGzip),
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

  tileMemCache.ecrire(key, buffer);

  const body = acceptsGzip ? buffer : gunzipSync(buffer);
  return new NextResponse(body as unknown as BodyInit, {
    headers: tileHeaders('MISS', acceptsGzip),
  });
}
