/**
 * GET /api/tiles/zones-risque/[z]/[x]/[y]?profil=<code>
 *
 * Tuiles MVT des zones de risque d'un profil de rayons (sql/205).
 *
 * ── POURQUOI SOUS `/api/tiles/` ──────────────────────────────────────────
 *
 * Pour être protégée sans toucher à `middleware.ts`, fichier protégé par
 * `CLAUDE.md`. Le `matcher` du middleware raisonne PAR SEGMENT : placée ici, la
 * route tombe sous `'/api/tiles/:path*'`, déjà présent dans le matcher ET dans
 * `PROTECTED_API_PREFIXES`. Même raisonnement que `/api/tiles/iris/`.
 *
 * Next.js donne la priorité au segment statique `zones-risque` sur le `[z]`
 * dynamique du voisin `/api/tiles/[z]/[x]/[y]`, qui exige exactement trois
 * segments : les deux routes ne peuvent pas se confondre.
 *
 * ── LE GZIP EST OBLIGATOIRE ──────────────────────────────────────────────
 *
 * MapLibre 5.x plante SILENCIEUSEMENT sur une tuile non compressée
 * (`CLAUDE.md`). Ce n'est pas une optimisation, c'est une condition de
 * fonctionnement.
 *
 * ── LE PROFIL EST DANS L'URL, ET C'EST CE QUI REND LE CACHE SÛR ──────────
 *
 * Deux profils différents ont deux codes différents, donc deux clés de cache.
 * Le code est réversible et sans collision possible : une empreinte au sens
 * strict pourrait servir les zones d'un profil sous la légende d'un autre, en
 * silence — le défaut que sql/196 a dû corriger sur `exposition_cache`.
 *
 * ⚠ **Le cache n'est PAS `immutable`**, contrairement aux tuiles d'IRIS et de
 * carreaux. Celles-là portent une version dans l'URL et changent de clé quand
 * la donnée change ; ici la clé est le profil, et les zones sont reconstruites
 * quand les SITES bougent — sans que le code du profil en sache rien. Une
 * heure de cache partagé est un compromis : assez pour un panoramique, assez
 * court pour qu'un import ne laisse pas une carte périmée une semaine.
 */
import { NextRequest, NextResponse } from 'next/server';
import { gzipSync, gunzipSync } from 'zlib';
import { createAdminClient } from '@/lib/auth';
import {
  creerCacheTuiles,
  BUDGET_CACHE_TUILES_OCTETS,
  TTL_CACHE_TUILES_MS,
} from '@/lib/tiles/cache-lru';
import { profilDepuisCode } from '@/lib/risques/code-profil';
import { ZONES_RISQUE_ZOOM_PLANCHER } from '@/lib/version';

export const dynamic = 'force-dynamic';

const cacheMemoire = creerCacheTuiles({
  budgetOctets: BUDGET_CACHE_TUILES_OCTETS,
  ttlMs: TTL_CACHE_TUILES_MS,
});
/** Déduplication : un panoramique ne doit pas demander dix fois la même tuile. */
const enVol = new Map<string, Promise<Buffer | null>>();

async function lireTuile(
  z: number, x: number, y: number, profil: string,
): Promise<Buffer | null> {
  const { data, error } = await createAdminClient().rpc('zones_risque_tuile', {
    p_z: z, p_x: x, p_y: y, p_profil_code: profil,
  });
  if (error) {
    console.error(`[tiles/zones-risque] ${z}/${x}/${y} :`, error.message);
    return null;
  }
  if (data === null || data === undefined) return null;

  // PostgREST rend le bytea en hexa préfixé `\x`, ou en base64 selon la version.
  const brut = String(data);
  const octets = brut.startsWith('\\x')
    ? Buffer.from(brut.slice(2), 'hex')
    : Buffer.from(brut, 'base64');
  return octets.length > 0 ? gzipSync(octets) : null;
}

function entetes(cache: 'HIT' | 'MISS', gzip: boolean): Record<string, string> {
  return {
    'Content-Type': 'application/vnd.mapbox-vector-tile',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    Vary: 'Accept-Encoding',
    'Cache-Control': 'public, max-age=600, s-maxage=3600',
    'X-Tile-Cache': cache,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await params;
  const zoom = parseInt(z, 10);
  const tx = parseInt(x, 10);
  const ty = parseInt(y, 10);

  if (Number.isNaN(zoom) || Number.isNaN(tx) || Number.isNaN(ty)) {
    return new NextResponse('Coordonnées de tuile invalides', { status: 400 });
  }

  const code = req.nextUrl.searchParams.get('profil') ?? '';
  /*
   * Le profil est RELU, jamais accepté sur parole : il sert de clé de cache
   * mémoire et de paramètre de requête. Un code fabriqué polluerait le cache
   * avec des entrées qui ne correspondent à rien.
   */
  if (!profilDepuisCode(code)) {
    return new NextResponse('Profil de rayons illisible', { status: 400 });
  }

  /*
   * Sous le plancher, on coupe ICI et pas seulement côté base : inutile
   * d'ouvrir une connexion pour se faire répondre une tuile vide. À l'échelle
   * de la France, une bande de 500 m mesure moins d'un pixel — la couche
   * afficherait une bouillie de traits pour un poids inutile.
   */
  if (zoom < ZONES_RISQUE_ZOOM_PLANCHER) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const accepteGzip = (req.headers.get('accept-encoding') ?? '').includes('gzip');
  const cle = `${code}/${zoom}/${tx}/${ty}`;

  const enCache = cacheMemoire.lire(cle);
  if (enCache) {
    const corps = accepteGzip ? enCache : gunzipSync(enCache);
    return new NextResponse(corps as unknown as BodyInit, {
      headers: entetes('HIT', accepteGzip),
    });
  }

  let promesse = enVol.get(cle);
  if (!promesse) {
    promesse = lireTuile(zoom, tx, ty, code).finally(() => { enVol.delete(cle); });
    enVol.set(cle, promesse);
  }

  const tuile = await promesse;
  if (!tuile) {
    // 204 et non 404 : l'absence de zone dans cette tuile est un résultat
    // normal, pas une erreur. MapLibre le traite comme une tuile vide.
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  cacheMemoire.ecrire(cle, tuile);
  const corps = accepteGzip ? tuile : gunzipSync(tuile);
  return new NextResponse(corps as unknown as BodyInit, {
    headers: entetes('MISS', accepteGzip),
  });
}
