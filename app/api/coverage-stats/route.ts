/**
 * POST /api/coverage-stats
 *
 * Calcule la couverture audience — streaming NDJSON, UN appel SQL par CIRFA.
 *
 * Seuls les groupes c__* (un par CIRFA) sont envoyés à la base de données.
 * __total__ et cum__* sont calculés côté client (panel) après réception de tous les c__*.
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
  const { poiGroups, metric = 'ind' } = await req.json() as {
    poiGroups: { id: string; nom: string; geometries: string[] }[];
    metric?: string;
  };

  // __total__ (union de toutes les géométries) + c__* (par CIRFA)
  // __total__ donne la couverture dédupliquée (carreaux couverts par AU MOINS une géométrie)
  const cirfaGroups = poiGroups.filter(g => g.id === '__total__' || g.id.startsWith('c__'));

  if (cirfaGroups.length === 0) {
    console.log('[coverage-stats] Aucun groupe c__* dans le payload — complete immédiat');
    return new Response(
      JSON.stringify({ type: 'complete', results: [], failed: 0 }) + '\n',
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    );
  }

  const payloadKB = Math.round(JSON.stringify(poiGroups).length / 1024);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(manquant)';

  console.log(`[coverage-stats] ═══ DÉBUT ═══`);
  console.log(`[coverage-stats] CIRFA: ${cirfaGroups.length} | metric: ${metric} | payload total: ~${payloadKB}KB`);
  console.log(`[coverage-stats] Supabase URL: ${supabaseUrl.slice(0, 50)}...`);
  console.log(`[coverage-stats] Groupes: ${cirfaGroups.map(g => g.id).join(', ')}`);
  console.log(`[coverage-stats] Géométries par groupe: ${cirfaGroups.map(g => `${g.id.replace('c__', '')}=${g.geometries.filter(Boolean).length}`).join(', ')}`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      const t0 = Date.now();
      const allResults: { group_id: string; coverage: number; nom: string }[] = [];
      let failedCount = 0;

      send({ type: 'start', total: cirfaGroups.length });

      for (let i = 0; i < cirfaGroups.length; i++) {
        const group = cirfaGroups[i];
        const tg    = Date.now();

        console.log(`[coverage-stats] [${i + 1}/${cirfaGroups.length}] START ${group.id} (${group.nom})`);
        send({ type: 'progress', current: i + 1, total: cirfaGroups.length, cirfa: group.id });

        try {
          const coverage = await rpcSingle({ id: group.id, geometries: group.geometries }, metric);
          const elapsed  = Date.now() - tg;
          const result   = { group_id: group.id, coverage, nom: group.nom };
          allResults.push(result);

          console.log(`[coverage-stats] [${i + 1}/${cirfaGroups.length}] OK ${group.id} → ${coverage.toLocaleString('fr-FR')} hab (${elapsed}ms)`);
          send({ type: 'cirfa_result', data: result, current: i + 1, total: cirfaGroups.length });
        } catch (e: any) {
          failedCount++;
          const isTimeout = e?.name === 'AbortError';
          const msg = isTimeout
            ? `Timeout (>${PER_GROUP_TIMEOUT_MS / 1000}s) — migration 043 appliquée dans Supabase ?`
            : (e.message ?? 'Erreur inconnue');
          console.error(`[coverage-stats] [${i + 1}/${cirfaGroups.length}] FAIL ${group.id} (${Date.now() - tg}ms): ${msg}`);
          send({ type: 'error_partial', cirfa: group.id, message: msg });
        }
      }

      const totalElapsed = Date.now() - t0;
      console.log(`[coverage-stats] ═══ FIN ═══ total: ${totalElapsed}ms | ok: ${allResults.length} | échecs: ${failedCount}`);
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
