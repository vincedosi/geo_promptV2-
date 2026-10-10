/**
 * MAGELIAN — API /api/meteo-geo
 *
 * Météo Open-Meteo agrégée par zones admin (régions, départements, codes postaux).
 * Un point par zone = centroïde de ref_regions / ref_departements / ref_codes_postaux
 * (RPC `get_zone_centroids_jsonb`, sql/243 — jumelle jsonb de `get_zone_centroids`,
 * qui rendait 1 000 CP sur 6 187 sous le plafond PostgREST ; sql/160 avait déjà
 * corrigé un palier CP à 0 ligne).
 *
 * Flow serveur :
 *   1. Auth + quota partagé (20 appels / 60 s par utilisateur — chaque appel
 *      peut consommer jusqu'à 500 unités du quota Open-Meteo gratuit)
 *   2. Validation des params (Zod + `validerPeriode`)
 *   3. Cache filesystem (clé = version+scale+variable+dates+bbox ARRONDIE)
 *   4. RPC get_zone_centroids_jsonb(scale, bbox arrondie en mode cp, borne)
 *      → {zones: [{code, nom, lat, lon}], tronque} ; aucune zone → erreur dite
 *      (plus de repli silencieux sur la France entière)
 *   5. Échantillonnage ≤ 500 points
 *   6. Appel Open-Meteo borné et repris (lib/http/lecture-avec-reprise)
 *   7. Flux NDJSON, cache filesystem écrit en arrière-plan
 *
 * Format de réponse : NDJSON (toujours), 1 ligne par étape.
 *   {"status":"fetching","progress":0,"total":1}
 *   {"status":"done","progress":1,"total":1,"data":{...},"meta":{...}}
 *
 * La logique pure (validation, hôte, URL, échantillonnage, bbox, clé de cache)
 * vit dans lib/meteo/requete.ts et y est testée.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { fetchLectureAvecReprise, type CauseReprise } from '@/lib/http/lecture-avec-reprise';
import { aggregatePeriod, computeStats, qualitativeLabel } from '@/lib/meteo/aggregation';
import { METEO_DAILY_FIELD, METEO_UNIT } from '@/lib/meteo/types';
import {
  arrondirBboxExterieur, buildOpenMeteoUrl, cleCache, parseBbox,
  pickHost, sampleZonePoints, todayStr, validerPeriode,
  MAX_POINTS_PER_BATCH,
  type Bbox, type QueryPoint, type ZoneCentroid,
} from '@/lib/meteo/requete';
import type {
  MeteoScale,
  MeteoVariable,
  MeteoZoneChunk,
  MeteoZoneMeta,
  MeteoZoneResponse,
  MeteoZoneValue,
} from '@/lib/meteo/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// L'échantillonnage spatial garantit 1 seul batch (≤500 points) quelle que
// soit l'échelle → quelques secondes. maxDuration large par sécurité (reprises 429).
export const maxDuration = 300;

/**
 * Quota partagé en base (`consommer_quota`, sql/135) — jamais une Map locale,
 * qui ne limiterait rien sur Vercel (CLAUDE.md). Un appel = jusqu'à 500 unités
 * du quota horaire Open-Meteo (5 000/h) : sans plafond, dix applications de
 * filtre en cache froid épuisent le quota pour tout le monde.
 */
const limiteur = createRateLimiter({ max: 20, window: '60 s', prefix: 'geo:rl:meteo-geo' });

const QuerySchema = z.object({
  scale: z.enum(['region', 'departement', 'cp']),
  variable: z.enum([
    'precipitation',
    'temperature_2m',
    'windspeed_10m',
    'sunshine_duration',
  ]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
  // Viewport optionnel (mode cp) : "west,south,east,north" — restreint les
  // zones interrogées à la vue carte pour rester sous 1 batch Open-Meteo.
  bbox: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/).optional(),
});

// Open-Meteo free tier : 600 appels/min, 5 000/h, 10 000/jour ; 1 coordonnée
// = 1 appel. Délai inter-batch = rester sous 600/min si jamais > 1 batch.
const INTER_BATCH_DELAY_MS = 62_000;
/** Reprises sur 429 « minute » : attendre que la fenêtre glissante se libère. */
const RATE_LIMIT_BACKOFFS_MS = [10_000, 30_000, 65_000];
/** Délai par tentative. Mesuré : une réponse de 500 points × 16 jours arrive en 2-4 s. */
const OPEN_METEO_DELAI_MS = 20_000;

/**
 * Borne écrite des zones lues en base (`get_zone_centroids_jsonb`, sql/243) :
 * au-dessus du référentiel complet — 6 187 codes postaux, 104 départements,
 * 18 régions (mesuré le 2026-10-10). La RPC rend du jsonb, hors troncature
 * PostgREST ; au-delà de la borne elle dit `tronque` et la route échoue plutôt
 * que de peindre un début de liste.
 */
const BORNE_ZONES = 10_000;

const CACHE_DIR = join(tmpdir(), 'meteo-cache');
const CACHE_TTL_HISTORY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_FORECAST_MS = 60 * 60 * 1000;

interface OpenMeteoPointResponse {
  daily?: Record<string, unknown> & { time?: string[] };
}

/** Quota horaire/journalier épuisé : retenter ne sert à rien (fenêtre d'une heure). */
const QUOTA_LONG = /hourly|daily/i;

async function fetchBatchFromOpenMeteo(
  points: QueryPoint[],
  variable: MeteoVariable,
  startDate: string,
  endDate: string,
  today: string,
): Promise<number[]> {
  const host = pickHost(startDate, endDate, today);
  const url = buildOpenMeteoUrl(host, points, variable, startDate, endDate);
  const dailyField = METEO_DAILY_FIELD[variable];

  const res = await fetchLectureAvecReprise(url, {}, {
    delaiMs: OPEN_METEO_DELAI_MS,
    tentatives: RATE_LIMIT_BACKOFFS_MS.length + 1,
    attente: async (tentative: number, cause: CauseReprise) => {
      if (cause.type === 'statut') {
        if (cause.reponse.status !== 429) return null;
        // Le corps dit si c'est la fenêtre minute (on attend) ou le quota
        // horaire/journalier (on échoue tout de suite, message clair).
        const corps = await cause.reponse.clone().text().catch(() => '');
        if (QUOTA_LONG.test(corps)) return null;
        logger.warn('meteo-geo', `429 Open-Meteo (minute), reprise dans ${RATE_LIMIT_BACKOFFS_MS[tentative]} ms`);
        return RATE_LIMIT_BACKOFFS_MS[tentative] ?? null;
      }
      // Expiration ou erreur réseau : une seule seconde reprise suffit, le
      // service répond en général en 2-4 s.
      return tentative === 0 ? 2_000 : null;
    },
  });

  if (res.status === 429) {
    const corps = await res.text().catch(() => '');
    if (QUOTA_LONG.test(corps)) {
      throw new Error(
        'Quota horaire Open-Meteo épuisé — réessayez dans l\'heure. ' +
        '(Les données déjà chargées restent en cache 24 h.)',
      );
    }
    throw new Error('Open-Meteo 429: limite par minute atteinte, réessayez dans une minute.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Open-Meteo ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as OpenMeteoPointResponse | OpenMeteoPointResponse[];
  const list: OpenMeteoPointResponse[] = Array.isArray(json) ? json : [json];
  if (list.length !== points.length) {
    // Une réponse plus courte que la demande décalerait toutes les zones d'un
    // cran : mieux vaut échouer que peindre Lyon avec la pluie de Paris.
    throw new Error(`Open-Meteo a rendu ${list.length} séries pour ${points.length} points`);
  }
  return list.map((entry) => {
    const rawValues = (entry.daily?.[dailyField] as (number | null)[] | undefined) ?? [];
    let agg = aggregatePeriod(rawValues, variable);
    // Open-Meteo renvoie sunshine_duration en secondes → heures pour l'affichage
    if (variable === 'sunshine_duration') agg = agg / 3600;
    return agg;
  });
}

function cacheFileName(cle: string): string {
  return createHash('md5').update(cle).digest('hex');
}

async function readCacheFile(key: string, isForecast: boolean): Promise<MeteoZoneResponse | null> {
  try {
    const path = join(CACHE_DIR, `${key}.json`);
    const st = await stat(path);
    const ttl = isForecast ? CACHE_TTL_FORECAST_MS : CACHE_TTL_HISTORY_MS;
    if (Date.now() - st.mtimeMs > ttl) return null;
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as MeteoZoneResponse;
  } catch {
    return null;
  }
}

async function writeCacheFile(key: string, payload: MeteoZoneResponse): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const path = join(CACHE_DIR, `${key}.json`);
    await writeFile(path, JSON.stringify(payload));
  } catch (e: unknown) {
    logger.warn('meteo-geo', 'écriture du cache impossible', e instanceof Error ? e.message : 'unknown');
  }
}

function ndjsonLine(chunk: MeteoZoneChunk): string {
  return JSON.stringify(chunk) + '\n';
}

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no',
} as const;

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    scale: searchParams.get('scale'),
    variable: searchParams.get('variable'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    bbox: searchParams.get('bbox') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const q = parsed.data;
  const today = todayStr();

  const erreurPeriode = validerPeriode(q.startDate, q.endDate, today);
  if (erreurPeriode) return NextResponse.json({ error: erreurPeriode }, { status: 400 });

  const isFuture = q.endDate >= today;
  const variable = q.variable as MeteoVariable;
  const scale = q.scale as MeteoScale;
  // La bbox ne vaut qu'au palier CP ; arrondie VERS L'EXTÉRIEUR, et c'est
  // cette bbox arrondie qui filtre les zones ET forme la clé de cache.
  const bboxArrondie: Bbox | undefined =
    q.bbox && scale === 'cp' ? arrondirBboxExterieur(parseBbox(q.bbox)) : undefined;
  const cacheKey = cacheFileName(cleCache(q.scale, q.variable, q.startDate, q.endDate, bboxArrondie));

  // ── Cache lookup ─────────────────────────────────────────────────────
  const cached = await readCacheFile(cacheKey, isFuture);
  if (cached) {
    logger.debug('meteo-geo', `cache HIT ${q.scale}/${q.variable} ${q.startDate}→${q.endDate}`);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const chunk: MeteoZoneChunk = {
          status: 'done',
          progress: cached.meta.batchesTotal || 1,
          total: cached.meta.batchesTotal || 1,
          data: cached.data,
          meta: cached.meta,
        };
        controller.enqueue(encoder.encode(ndjsonLine(chunk)));
        controller.close();
      },
    });
    return new Response(stream, { headers: { ...NDJSON_HEADERS, 'X-Meteo-Cache': 'hit' } });
  }

  // ── Centroïdes de la vue, en UN passage (sql/243) ───────────────────
  // `get_zone_centroids` (RETURNS TABLE) était coupée par PostgREST : 1 000
  // centroïdes sur 6 187 en local, et la bbox filtrait ENSUITE ce début en
  // mémoire. La jumelle jsonb filtre la bbox en base (index GIST) et dit
  // `tronque` si la borne est atteinte.
  const supabase = createAdminClient();
  const { data: brut, error: rpcError } = await supabase.rpc('get_zone_centroids_jsonb', {
    p_scale: q.scale,
    ...(bboxArrondie
      ? { p_ouest: bboxArrondie[0], p_sud: bboxArrondie[1], p_est: bboxArrondie[2], p_nord: bboxArrondie[3] }
      : {}),
    p_limite: BORNE_ZONES,
  });
  const lu = brut as { zones: ZoneCentroid[]; tronque: boolean } | null;
  if (rpcError || !lu) {
    logger.error('meteo-geo', `get_zone_centroids_jsonb : ${rpcError?.message ?? 'sans donnée'}`);
    return NextResponse.json({ error: 'Lecture des zones météo impossible.' }, { status: 500 });
  }
  if (lu.tronque) {
    logger.error('meteo-geo', `plus de ${BORNE_ZONES} zones au palier ${q.scale}`);
    return NextResponse.json(
      { error: `Plus de ${BORNE_ZONES} codes postaux ou zones à lire : la carte ne peut pas les afficher.` },
      { status: 500 },
    );
  }
  const zones = lu.zones;
  if (zones.length === 0) {
    // Plus de repli sur la France entière : il peignait la météo d'un autre
    // territoire sans signe d'échec (défaut A de docs/SUITE_TRONCATURE_POSTGREST.md).
    const encoder = new TextEncoder();
    const vide = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ndjsonLine({
          status: 'error',
          error: bboxArrondie ? 'Aucun code postal dans la zone affichée.' : 'Aucune zone pour cette échelle.',
        })));
        controller.close();
      },
    });
    return new Response(vide, { headers: NDJSON_HEADERS });
  }

  // ── Échantillonnage spatial → toujours 1 seul batch Open-Meteo ───────
  const { points, assign } = sampleZonePoints(zones, MAX_POINTS_PER_BATCH);

  const batches: QueryPoint[][] = [];
  for (let i = 0; i < points.length; i += MAX_POINTS_PER_BATCH) {
    batches.push(points.slice(i, i + MAX_POINTS_PER_BATCH));
  }
  const totalBatches = batches.length;
  logger.debug('meteo-geo', `cache MISS ${q.scale}/${q.variable} zones=${zones.length} points=${points.length} batches=${totalBatches}`);

  // ── Streaming NDJSON ─────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const pointValues: number[] = [];

        for (let i = 0; i < totalBatches; i++) {
          const remainingBatches = totalBatches - i;
          const etaMs = remainingBatches > 1
            ? (remainingBatches - 1) * INTER_BATCH_DELAY_MS + remainingBatches * 3000
            : 3000;

          controller.enqueue(encoder.encode(ndjsonLine({
            status: 'fetching', progress: i, total: totalBatches, etaMs,
          })));

          const values = await fetchBatchFromOpenMeteo(batches[i], variable, q.startDate, q.endDate, today);
          pointValues.push(...values);

          if (i < totalBatches - 1 && totalBatches > 1) {
            await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
          }
        }

        // Valeur par zone : chaque zone reçoit la valeur de son point échantillonné
        const zoneValues = zones.map((_, i) => pointValues[assign[i]]);

        // Stats par zone (et non par point) pour des quantiles fidèles à la choroplèthe.
        const stats = computeStats(zoneValues, variable);
        const unit = variable === 'sunshine_duration' ? 'h' : METEO_UNIT[variable];
        stats.unit = unit;

        const data: Record<string, MeteoZoneValue> = {};
        for (let i = 0; i < zones.length; i++) {
          const value = zoneValues[i];
          data[zones[i].code] = { value, unit, label: qualitativeLabel(value, stats, variable) };
        }

        const meta: MeteoZoneMeta = {
          variable,
          unit,
          startDate: q.startDate,
          endDate: q.endDate,
          scale,
          stats,
          totalZones: zones.length,
          batchesTotal: totalBatches,
          sampledPoints: points.length,
          cachedAt: null,
        };

        void writeCacheFile(cacheKey, {
          data,
          meta: { ...meta, cachedAt: new Date().toISOString() },
        });

        controller.enqueue(encoder.encode(ndjsonLine({
          status: 'done', progress: totalBatches, total: totalBatches, data, meta,
        })));
        controller.close();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown error';
        logger.error('meteo-geo', `flux interrompu : ${msg}`);
        controller.enqueue(encoder.encode(ndjsonLine({ status: 'error', error: msg })));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { ...NDJSON_HEADERS, 'X-Meteo-Cache': 'miss' } });
}
