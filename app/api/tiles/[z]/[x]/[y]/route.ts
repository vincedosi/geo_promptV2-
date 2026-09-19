/**
 * GET /api/tiles/[z]/[x]/[y] — tuiles MVT des carreaux Filosofi.
 *
 * Route la plus lourde du projet : 77 % du temps base mesuré à l'audit du
 * 2026-09-13 (40 510 798 ms sur 6 519 appels). Trois correctifs y ont été
 * appliqués le même jour, et chacun répare quelque chose de précis.
 *
 * 1. **Gzip** (`CLAUDE.md` le déclare obligatoire sur les réponses MVT). Les
 *    routes IRIS et TMJA s'y tenaient, celle-ci non : elle servait la tuile
 *    brute. Une salve de 12 tuiles passe d'environ 3,56 Mo à 0,89 Mo.
 *    La tuile est stockée DÉJÀ gzippée en cache mémoire, et dégzippée à la
 *    volée pour le rare client qui n'accepte pas l'encodage — même patron que
 *    `/api/tiles/iris`.
 *
 * 2. **`s-maxage`.** L'en-tête valait `public, max-age=3600`, sans aucune
 *    directive pour le CDN : chaque visiteur repayait la tuile côté base.
 *    Avec `s-maxage=604800`, la même tuile vue par un second utilisateur ne
 *    touche plus Postgres. La réponse est versionnée par `?v=`
 *    (`CARREAUX_TILE_VERSION`), donc `immutable` est sûr : un changement de
 *    schéma de tuile change la clé, il n'y a rien à invalider.
 *
 *    ⚠ Le gain reste partiel tant que `/api/tiles/**` passe par le cookie de
 *    session : un CDN ne mutualise pas une réponse authentifiée entre
 *    visiteurs. C'est le point 2 de `docs/audit/QUICK_WINS.md`, laissé de côté
 *    ici parce qu'il touche `middleware.ts`, fichier protégé (`CLAUDE.md`).
 *
 * 3. **Cache mémoire borné en octets et évincé par usage**
 *    (`lib/tiles/cache-lru.ts`). L'ancien cache plafonnait à 1 000 ENTRÉES et
 *    purgeait les 200 premières clés INSÉRÉES : il évinçait donc une tuile très
 *    demandée avant une tuile vue une seule fois, et 1 000 tuiles à 297 ko
 *    faisaient 297 Mo de RSS dans une fonction qui en a 1 024.
 */
import { NextRequest, NextResponse } from 'next/server';
import { gzipSync, gunzipSync } from 'zlib';
import { createAdminClient } from '@/lib/auth';
import {
  creerCacheTuiles,
  BUDGET_CACHE_TUILES_OCTETS,
  TTL_CACHE_TUILES_MS,
} from '@/lib/tiles/cache-lru';

// service_role requis pour les RPCs de tiles (bypass RLS intentionnel)
function getSupabase() {
  return createAdminClient();
}

export const dynamic = 'force-dynamic';

const tileMemCache = creerCacheTuiles({
  budgetOctets: BUDGET_CACHE_TUILES_OCTETS,
  ttlMs: TTL_CACHE_TUILES_MS,
});
const pendingTiles = new Map<string, Promise<Buffer | null>>();

/** Renvoie la tuile MVT DÉJÀ gzippée (elle est stockée gzippée en cache). */
async function fetchTileBuffer(zoom: number, tileX: number, tileY: number): Promise<Buffer | null> {
  const { data, error } = await getSupabase().rpc('get_tile', { z: zoom, x: tileX, y: tileY });

  if (error) {
    console.error(`[tiles] ${zoom}/${tileX}/${tileY} error:`, error.message);
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
    // Sans `Vary`, un cache partagé pourrait servir une réponse gzippée à un
    // client qui ne l'accepte pas.
    'Vary': 'Accept-Encoding',
    // Versionné par ?v= → immutable. s-maxage = cache CDN partagé entre
    // utilisateurs et entre instances.
    'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
    'X-Tile-Cache': cacheStatus,
    'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://genesis.vercel.app',
  };
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

  // Borne basse alignee sur la cascade de get_tile (sql/129), qui sert le palier
  // 20 km jusqu'a z4. Elle valait 6 : les tuiles des bas zooms etaient refusees
  // en 204 cote serveur, en plus du minzoom 6 cote MapLibre — le verrou etait a
  // trois endroits (source, couche, route).
  if (zoom < 4) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const acceptsGzip = (req.headers.get('accept-encoding') ?? '').includes('gzip');
  const v   = req.nextUrl.searchParams.get('v') ?? '0';
  const key = `${v}/${zoom}/${tileX}/${tileY}`;

  // 1. Cache mémoire hit
  const cached = tileMemCache.lire(key);
  if (cached) {
    const body = acceptsGzip ? cached : gunzipSync(cached);
    return new NextResponse(body as unknown as BodyInit, {
      headers: tileHeaders('HIT', acceptsGzip),
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

  // 3. Stocker en mémoire (gzippé)
  tileMemCache.ecrire(key, buffer);

  const body = acceptsGzip ? buffer : gunzipSync(buffer);
  return new NextResponse(body as unknown as BodyInit, {
    headers: tileHeaders('MISS', acceptsGzip),
  });
}
