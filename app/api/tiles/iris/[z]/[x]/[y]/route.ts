/**
 * GET /api/tiles/iris/[z]/[x]/[y]
 *
 * Tuiles MVT des IRIS, servies depuis Postgres (`get_iris_tile`, TER-001).
 *
 * ── Pourquoi cette route existe ─────────────────────────────────────────────
 *
 * La carte chargeait `pmtiles:///iris_france.pmtiles`, un fichier de 361 Mo posé
 * dans `public/`. Ce fichier est exclu par `.gitignore` ET par `.vercelignore` :
 * il n'est jamais parti en production, où l'URL répond la page 404 de Next —
 * `<!DOCTYPE` au lieu de `PMTiles\x03`, vérifié. L'autre chemin documenté, une
 * GitHub Release, renvoie 404 en anonyme puisque le dépôt est privé.
 *
 * La couche IRIS ne s'affichait donc que sur le poste du développeur, où le
 * fichier est sur le disque. Aucune erreur visible : MapLibre échoue en silence
 * sur une source vide.
 *
 * ── Plomberie ───────────────────────────────────────────────────────────────
 *
 * Calquée sur `/api/tmja-tiles/[z]/[x]/[y]`, qui est le patron éprouvé du
 * projet : gzip obligatoire (MapLibre 5.x plante silencieusement sans),
 * cache CDN partagé, cache mémoire par lambda en bonus, et déduplication des
 * requêtes simultanées pour qu'un déplacement de carte ne déclenche pas dix
 * fois la même tuile.
 *
 * ── Pourquoi sous `/api/tiles/` et pas `/api/iris-tiles/` ───────────────────
 *
 * Pour être protégée sans toucher à `middleware.ts`, fichier protégé par
 * `CLAUDE.md`. Le `matcher` du middleware raisonne PAR SEGMENT :
 * `'/api/iris/:path*'` ne couvre pas `/api/iris-tiles` — le fichier le dit
 * lui-même, et c'est pour cette raison que `/api/iris-crawler` y a sa propre
 * ligne. Placée ici, la route tombe sous `'/api/tiles/:path*'`, déjà présent
 * dans le matcher ET dans `PROTECTED_API_PREFIXES`.
 *
 * Next.js donne la priorité au segment statique `iris` sur le `[z]` dynamique
 * du voisin `/api/tiles/[z]/[x]/[y]`, et ce dernier exige exactement trois
 * segments : les deux routes ne peuvent pas se confondre.
 *
 * Mesures (tuile brute avant gzip) :
 *   z9  231 kB — 79 ms      z12  43 kB
 *   z10 154 kB              z13  19 kB
 *
 * Le 2026-09-12, la tuile parisienne la plus dense a été mesurée séparément :
 * 9/259/176 pèse 788 kB pour 3 387 IRIS. Les 231 kB ci-dessus sont donc un cas
 * courant, pas un plafond — c'est le chiffre à retenir pour juger du coût.
 *
 * Sous le plancher, la RPC rend NULL et cette route répond 204 : un IRIS d'un
 * kilomètre y mesure moins de 10 px, et une tuile z5 pesait 1 694 kB pour
 * 31 149 IRIS indistinguables. Le plancher lui-même vit dans `lib/version.ts`,
 * avec le détail des mesures qui interdisent de le baisser.
 */
import { NextRequest, NextResponse } from 'next/server';
import { gzipSync, gunzipSync } from 'zlib';
import { createAdminClient } from '@/lib/auth';
import { IRIS_ZOOM_PLANCHER } from '@/lib/version';

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

/** Renvoie la tuile MVT déjà gzippée (stockée gzippée en cache mémoire). */
async function fetchTileBuffer(zoom: number, tileX: number, tileY: number): Promise<Buffer | null> {
  const { data, error } = await createAdminClient()
    .rpc('get_iris_tile', { z: zoom, x: tileX, y: tileY });
  if (error) {
    console.error(`[tiles/iris] ${zoom}/${tileX}/${tileY} error:`, error.message);
    return null;
  }
  if (data === null || data === undefined) return null;
  // PostgREST rend le bytea en hexa préfixé `\x`, ou en base64 selon la version.
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
    'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://geo-prompt-v2.vercel.app',
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

  // On coupe ici AUSSI, et pas seulement dans la RPC : inutile d'ouvrir une
  // connexion à la base pour se faire répondre NULL.
  if (zoom < IRIS_ZOOM_PLANCHER) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const acceptsGzip = (req.headers.get('accept-encoding') ?? '').includes('gzip');
  const v = req.nextUrl.searchParams.get('v') ?? '0';
  const key = `${v}/${zoom}/${tileX}/${tileY}`;
  const now = Date.now();

  const cached = tileMemCache.get(key);
  if (cached && now < cached.expires) {
    const body = acceptsGzip ? cached.buf : gunzipSync(cached.buf);
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

  pruneCacheIfNeeded();
  tileMemCache.set(key, { buf: buffer, expires: now + CACHE_TTL_MS });

  const body = acceptsGzip ? buffer : gunzipSync(buffer);
  return new NextResponse(body as unknown as BodyInit, {
    headers: tileHeaders('MISS', acceptsGzip),
  });
}
