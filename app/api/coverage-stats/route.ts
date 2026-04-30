/**
 * POST /api/coverage-stats
 *
 * Calcule la couverture audience — streaming NDJSON, UN appel SQL par groupe.
 *
 * Groupes acceptés :
 *   c__<id>        — un par POI (cacheable)
 *   total_pal__<N> — union dédupliquée de TOUS les POIs au palier N (JAMAIS mis en cache)
 *
 * IMPORTANT : utilise fetch() direct vers Supabase REST (PAS supabase.rpc()) pour deux raisons :
 *   1. supabase.rpc() passe par PgBouncer transaction mode → temp tables orphelines (OID error)
 *   2. supabase.rpc() a un timeout JS ~8s, insuffisant pour les requêtes spatiales
 *
 * Body   : { poiGroups: { id, nom, geometries }[], metric?: string }
 * Events :
 *   { type: 'start',         total: N }
 *   { type: 'progress',      current, total, poi }
 *   { type: 'poi_result',    data: { group_id, coverage, nom }, current, total }
 *   { type: 'error_partial', poi, message }
 *   { type: 'complete',      results, failed }
 */
import { NextRequest } from 'next/server';
import { createAdminClient }  from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const maxDuration = 120;

// SQL statement_timeout = '25s' → JS abort à 28s pour lire le message d'erreur SQL
// avant que le AbortController coupe la connexion
const PER_GROUP_TIMEOUT_MS = 28_000;

// ── Réduit la précision des coordonnées GeoJSON (6 décimales → 4) ─────────────
// 4 décimales = ~11m de précision, largement suffisant pour grille INSEE 200m.
// Réduit le payload de ~30% et accélère ST_UnaryUnion côté Postgres.
function simplifyGeomPrecision(geojson: string): string {
  return geojson.replace(/(-?\d+\.\d{5,})/g, m => parseFloat(m).toFixed(4));
}

// ── fetch() direct — contourne PgBouncer + timeout JS 8s ──────────────────────
async function rpcSingle(
  group: { id: string; geometries: string[] },
  metric: string,
): Promise<number> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Variables env manquantes : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY');
  }

  const geoms = group.geometries.filter(Boolean).map(simplifyGeomPrecision);
  const payloadBytes = JSON.stringify(geoms).length;

  console.log(`[coverage-stats] → RPC single | group=${group.id} | geoms=${geoms.length} | payload=${Math.round(payloadBytes / 1024)}KB | metric=${metric}`);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), PER_GROUP_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/rest/v1/rpc/calculate_coverage_per_group`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':  'application/json',
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer':        'return=representation',
      },
      body: JSON.stringify({
        p_groups: [{ id: group.id, geometries: geoms }],
        p_column: metric,
      }),
    });
  } finally {
    clearTimeout(tid);
  }

  console.log(`[coverage-stats] → HTTP ${res.status} | group=${group.id}`);

  if (!res.ok) {
    const txt = await res.text().catch(() => `HTTP ${res.status}`);
    let msg = txt;
    try { msg = JSON.parse(txt)?.message ?? txt; } catch { /* */ }
    console.error(`[coverage-stats] → RPC ERROR | group=${group.id} | ${msg.slice(0, 400)}`);
    throw new Error(msg.slice(0, 300));
  }

  const rows = await res.json() as { group_id: string; coverage: number }[];
  console.log(`[coverage-stats] → RPC OK | group=${group.id} | rows=${rows.length} | coverage=${rows[0]?.coverage ?? 0}`);
  return Number(rows[0]?.coverage ?? 0);
}

// ── Clé de cache par POI individuel ───────────────────────────────────────────
// geomFingerprint = taille des géométries simplifiées (proxy des paramètres de bataille)
function perPoiCoverageKey(groupId: string, geometries: string[], metric: string): string {
  const simplified = geometries.filter(Boolean).map(simplifyGeomPrecision);
  const geomLen    = simplified.join('').length;
  return `cov__${groupId}__${geomLen}__${metric}`;
}

// ── Route ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { poiGroups, metric = 'ind', battleCacheKey: _bck } = await req.json() as {
    poiGroups: { id: string; nom: string; geometries: string[] }[];
    metric?: string;
    battleCacheKey?: string;
  };

  // c__*         → couverture par POI (cacheable individuellement)
  // total_pal__* → union dédupliquée par palier (JAMAIS mise en cache)
  const perPoiGroups   = poiGroups.filter(g => g.id.startsWith('c__'));
  const totalPalGroups = poiGroups.filter(g => g.id.startsWith('total_pal__'));

  if (perPoiGroups.length === 0 && totalPalGroups.length === 0) {
    return new Response(
      JSON.stringify({ type: 'complete', results: [], failed: 0 }) + '\n',
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    );
  }

  // ── Lookup cache en batch pour tous les POIs ──────────────────────────────
  const cacheKeyMap = new Map<string, string>(); // groupId → cacheKey
  for (const g of perPoiGroups) {
    cacheKeyMap.set(g.id, perPoiCoverageKey(g.id, g.geometries, metric));
  }

  const cacheHitMap = new Map<string, number>(); // groupId → coverage
  if (perPoiGroups.length > 0) {
    const supabaseAdmin = createAdminClient();
    const keys = [...cacheKeyMap.values()];
    const { data: rows } = await supabaseAdmin
      .from('isochrones_cache')
      .select('cache_key, geojson')
      .in('cache_key', keys);

    if (rows) {
      const keyToGroupId = new Map([...cacheKeyMap.entries()].map(([gid, ck]) => [ck, gid]));
      for (const row of rows) {
        const gid = keyToGroupId.get(row.cache_key);
        if (gid) cacheHitMap.set(gid, (row.geojson as { coverage?: number } | null)?.coverage ?? 0);
      }
    }
    console.log(`[coverage-stats] Cache: ${cacheHitMap.size}/${perPoiGroups.length} POIs en cache`);
  }

  const toCompute  = perPoiGroups.filter(g => !cacheHitMap.has(g.id));
  const totalSteps = cacheHitMap.size + toCompute.length + totalPalGroups.length;

  const payloadKB = Math.round(JSON.stringify(poiGroups).length / 1024);
  console.log(`[coverage-stats] ═══ DÉBUT ═══`);
  console.log(`[coverage-stats] POI: ${perPoiGroups.length} (cache=${cacheHitMap.size} hits, à calculer=${toCompute.length}) | total_pal: ${totalPalGroups.length} | metric: ${metric} | ~${payloadKB}KB`);

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      const t0 = Date.now();
      const allResults: { group_id: string; coverage: number; nom: string }[] = [];
      let failedCount = 0;
      let idx = 0;

      send({ type: 'start', total: totalSteps });

      // ── Étape 1 : POIs en cache → streamés immédiatement ─────────────────
      for (const group of perPoiGroups) {
        if (!cacheHitMap.has(group.id)) continue;
        const coverage = cacheHitMap.get(group.id)!;
        const result   = { group_id: group.id, coverage, nom: group.nom };
        allResults.push(result);
        send({ type: 'poi_result', data: result, current: ++idx, total: totalSteps, fromCache: true });
      }
      if (cacheHitMap.size > 0) {
        console.log(`[coverage-stats] ${cacheHitMap.size} POIs depuis le cache (instantané)`);
      }

      // ── Étape 2 : POIs manquants → calcul + écriture cache ───────────────
      for (let i = 0; i < toCompute.length; i++) {
        const group = toCompute[i];
        const tg    = Date.now();

        send({ type: 'progress', current: ++idx, total: totalSteps, poi: group.id });
        console.log(`[coverage-stats] [calc ${i + 1}/${toCompute.length}] START ${group.id}`);

        try {
          const coverage = await rpcSingle({ id: group.id, geometries: group.geometries }, metric);
          const result   = { group_id: group.id, coverage, nom: group.nom };
          allResults.push(result);
          console.log(`[coverage-stats] [calc ${i + 1}/${toCompute.length}] OK ${group.id} → ${coverage.toLocaleString('fr-FR')} hab (${Date.now() - tg}ms)`);
          send({ type: 'poi_result', data: result, current: idx, total: totalSteps });

          // Écriture cache individuelle (fire & forget)
          const ck = cacheKeyMap.get(group.id)!;
          createAdminClient().from('isochrones_cache').upsert({
            cache_key: ck, ville: '_coverage_', categorie: metric,
            minutes: 0, mode: 'coverage',
            geojson: { coverage },
            poi_count: 1, created_at: new Date().toISOString(),
          }, { onConflict: 'cache_key' }).then(({ error }) => {
            if (error) console.warn(`[coverage-stats] cache write fail ${ck}:`, error.message);
          });

        } catch (e: unknown) {
          failedCount++;
          const msg = e instanceof Error && e.name === 'AbortError'
            ? `Timeout (>${PER_GROUP_TIMEOUT_MS / 1000}s)`
            : (e instanceof Error ? e.message : 'Erreur inconnue');
          console.error(`[coverage-stats] [calc ${i + 1}/${toCompute.length}] FAIL ${group.id} (${Date.now() - tg}ms): ${msg}`);
          send({ type: 'error_partial', poi: group.id, message: msg });
        }
      }

      // ── Étape 3 : total_pal__* — toujours recalculé ───────────────────────
      for (let i = 0; i < totalPalGroups.length; i++) {
        const group = totalPalGroups[i];
        const tg    = Date.now();

        send({ type: 'progress', current: ++idx, total: totalSteps, poi: group.id });
        console.log(`[coverage-stats] [pal ${i + 1}/${totalPalGroups.length}] START ${group.id} (${group.geometries.filter(Boolean).length} geoms)`);

        try {
          const coverage = await rpcSingle({ id: group.id, geometries: group.geometries }, metric);
          const result   = { group_id: group.id, coverage, nom: group.nom };
          allResults.push(result);
          console.log(`[coverage-stats] [pal ${i + 1}/${totalPalGroups.length}] OK ${group.id} → ${coverage.toLocaleString('fr-FR')} hab (${Date.now() - tg}ms)`);
          send({ type: 'poi_result', data: result, current: idx, total: totalSteps });
        } catch (e: unknown) {
          failedCount++;
          const msg = e instanceof Error && e.name === 'AbortError'
            ? `Timeout (>${PER_GROUP_TIMEOUT_MS / 1000}s)`
            : (e instanceof Error ? e.message : 'Erreur inconnue');
          console.error(`[coverage-stats] [pal ${i + 1}/${totalPalGroups.length}] FAIL ${group.id} (${Date.now() - tg}ms): ${msg}`);
          send({ type: 'error_partial', poi: group.id, message: msg });
        }
      }

      console.log(`[coverage-stats] ═══ FIN ═══ total: ${Date.now() - t0}ms | ok: ${allResults.length} | échecs: ${failedCount}`);
      send({ type: 'complete', results: allResults, failed: failedCount });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':      'application/x-ndjson',
      'Cache-Control':     'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
