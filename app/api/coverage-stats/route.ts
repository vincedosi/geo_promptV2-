/**
 * POST /api/coverage-stats
 *
 * Calcule la couverture audience — streaming NDJSON, UN appel SQL par groupe.
 *
 * Groupes acceptés :
 *   c__<id>        — un par CIRFA (cacheable)
 *   total_pal__<N> — union dédupliquée de TOUS les CIRFAs au palier N (JAMAIS mis en cache)
 *
 * IMPORTANT : utilise fetch() direct vers Supabase REST (PAS supabase.rpc()) pour deux raisons :
 *   1. supabase.rpc() passe par PgBouncer transaction mode → temp tables orphelines (OID error)
 *   2. supabase.rpc() a un timeout JS ~8s, insuffisant pour les requêtes spatiales
 *
 * Body   : { poiGroups: { id, nom, geometries }[], metric?: string }
 * Events :
 *   { type: 'start',         total: N }
 *   { type: 'progress',      current, total, cirfa }
 *   { type: 'cirfa_result',  data: { group_id, coverage, nom }, current, total }
 *   { type: 'error_partial', cirfa, message }
 *   { type: 'complete',      results, failed }
 */
import { NextRequest } from 'next/server';
import { createAdminClient }  from '@/lib/auth';

export const maxDuration = 120;

// SQL statement_timeout = '25s' → JS abort à 28s pour lire le message d'erreur SQL
// avant que le AbortController coupe la connexion
const PER_GROUP_TIMEOUT_MS = 28_000;

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

  const geoms = group.geometries.filter(Boolean);
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

// ── Route ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { poiGroups, metric = 'ind', battleCacheKey } = await req.json() as {
    poiGroups: { id: string; nom: string; geometries: string[] }[];
    metric?: string;
    battleCacheKey?: string;
  };

  // c__*         → couverture par CIRFA (cacheable)
  // total_pal__* → couverture dédupliquée par palier (JAMAIS mise en cache — toujours fraîche)
  const cirfaGroups    = poiGroups.filter(g => g.id.startsWith('c__'));
  const totalPalGroups = poiGroups.filter(g => g.id.startsWith('total_pal__'));

  if (cirfaGroups.length === 0 && totalPalGroups.length === 0) {
    console.log('[coverage-stats] Aucun groupe dans le payload — complete immédiat');
    return new Response(
      JSON.stringify({ type: 'complete', results: [], failed: 0 }) + '\n',
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    );
  }

  // ── Vérification cache (c__* seulement) ───────────────────────────────────
  let cachedCirfaResults: { group_id: string; coverage: number; nom: string }[] | null = null;
  if (battleCacheKey && cirfaGroups.length > 0) {
    const coverageCacheKey = `coverage__${battleCacheKey}__${metric}`;
    const supabaseAdmin = createAdminClient();
    const { data: cached } = await supabaseAdmin
      .from('isochrones_cache')
      .select('geojson')
      .eq('cache_key', coverageCacheKey)
      .single();

    if (cached?.geojson) {
      const results = (cached.geojson as any).results as { group_id: string; coverage: number; nom: string }[];
      if (results?.filter(r => r.group_id.startsWith('c__')).length > 0) {
        cachedCirfaResults = results.filter(r => r.group_id.startsWith('c__'));
        console.log(`[coverage-stats] Cache HIT c__* (${cachedCirfaResults.length} résultats) — total_pal__* sera recalculé`);
      }
    }
  }

  const payloadKB = Math.round(JSON.stringify(poiGroups).length / 1024);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(manquant)';
  const totalToCompute = (cachedCirfaResults ? 0 : cirfaGroups.length) + totalPalGroups.length;

  console.log(`[coverage-stats] ═══ DÉBUT ═══`);
  console.log(`[coverage-stats] CIRFA: ${cirfaGroups.length} (cache=${!!cachedCirfaResults}) | total_pal: ${totalPalGroups.length} | metric: ${metric} | ~${payloadKB}KB`);
  console.log(`[coverage-stats] Supabase URL: ${supabaseUrl.slice(0, 50)}...`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      const t0 = Date.now();
      const allResults: { group_id: string; coverage: number; nom: string }[] = [];
      let failedCount = 0;
      let idx = 0;

      send({ type: 'start', total: totalToCompute });

      // ── Étape 1 : c__* (cache ou calcul) ──────────────────────────────────
      if (cachedCirfaResults) {
        for (const r of cachedCirfaResults) {
          allResults.push(r);
          send({ type: 'cirfa_result', data: r, current: ++idx, total: totalToCompute, fromCache: true });
        }
      } else {
        for (let i = 0; i < cirfaGroups.length; i++) {
          const group = cirfaGroups[i];
          const tg = Date.now();

          console.log(`[coverage-stats] [c ${i + 1}/${cirfaGroups.length}] START ${group.id}`);
          send({ type: 'progress', current: ++idx, total: totalToCompute, cirfa: group.id });

          try {
            const coverage = await rpcSingle({ id: group.id, geometries: group.geometries }, metric);
            const elapsed  = Date.now() - tg;
            const result   = { group_id: group.id, coverage, nom: group.nom };
            allResults.push(result);
            console.log(`[coverage-stats] [c ${i + 1}/${cirfaGroups.length}] OK ${group.id} → ${coverage.toLocaleString('fr-FR')} hab (${elapsed}ms)`);
            send({ type: 'cirfa_result', data: result, current: idx, total: totalToCompute });
          } catch (e: any) {
            failedCount++;
            const isTimeout = e?.name === 'AbortError';
            const msg = isTimeout
              ? `Timeout (>${PER_GROUP_TIMEOUT_MS / 1000}s) — migration 043 appliquée dans Supabase ?`
              : (e.message ?? 'Erreur inconnue');
            console.error(`[coverage-stats] [c ${i + 1}/${cirfaGroups.length}] FAIL ${group.id} (${Date.now() - tg}ms): ${msg}`);
            send({ type: 'error_partial', cirfa: group.id, message: msg });
          }
        }
      }

      // ── Étape 2 : total_pal__* — TOUJOURS calculé frais (jamais mis en cache) ──
      for (let i = 0; i < totalPalGroups.length; i++) {
        const group = totalPalGroups[i];
        const tg = Date.now();

        console.log(`[coverage-stats] [pal ${i + 1}/${totalPalGroups.length}] START ${group.id} (${group.geometries.filter(Boolean).length} geoms)`);
        send({ type: 'progress', current: ++idx, total: totalToCompute, cirfa: group.id });

        try {
          const coverage = await rpcSingle({ id: group.id, geometries: group.geometries }, metric);
          const elapsed  = Date.now() - tg;
          const result   = { group_id: group.id, coverage, nom: group.nom };
          allResults.push(result);
          console.log(`[coverage-stats] [pal ${i + 1}/${totalPalGroups.length}] OK ${group.id} → ${coverage.toLocaleString('fr-FR')} hab (${elapsed}ms)`);
          send({ type: 'cirfa_result', data: result, current: idx, total: totalToCompute });
        } catch (e: any) {
          failedCount++;
          const isTimeout = e?.name === 'AbortError';
          const msg = isTimeout
            ? `Timeout (>${PER_GROUP_TIMEOUT_MS / 1000}s) — migration 043 appliquée dans Supabase ?`
            : (e.message ?? 'Erreur inconnue');
          console.error(`[coverage-stats] [pal ${i + 1}/${totalPalGroups.length}] FAIL ${group.id} (${Date.now() - tg}ms): ${msg}`);
          send({ type: 'error_partial', cirfa: group.id, message: msg });
        }
      }

      const totalElapsed = Date.now() - t0;
      console.log(`[coverage-stats] ═══ FIN ═══ total: ${totalElapsed}ms | ok: ${allResults.length} | échecs: ${failedCount}`);
      send({ type: 'complete', results: allResults, failed: failedCount });

      // ── Écriture cache c__* seulement ────────────────────────────────────
      if (battleCacheKey && !cachedCirfaResults && failedCount === 0) {
        const cirfaOnly = allResults.filter(r => r.group_id.startsWith('c__'));
        if (cirfaOnly.length > 0) {
          const coverageCacheKey = `coverage__${battleCacheKey}__${metric}`;
          const supabaseAdmin = createAdminClient();
          supabaseAdmin.from('isochrones_cache').upsert({
            cache_key:  coverageCacheKey,
            ville:      '_coverage_',
            categorie:  metric,
            minutes:    0,
            mode:       'coverage',
            geojson:    { results: cirfaOnly },
            poi_count:  cirfaOnly.length,
            created_at: new Date().toISOString(),
          }, { onConflict: 'cache_key' }).then(({ error }) => {
            if (error) console.warn('[coverage-stats] cache write fail:', error.message);
          });
        }
      }

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
