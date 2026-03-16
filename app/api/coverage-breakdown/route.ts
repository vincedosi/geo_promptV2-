/**
 * POST /api/coverage-breakdown
 * Calcule la couverture audience par POI (batch SQL, une seule requête).
 * Body: { poiGroups: { id, nom, geometries }[], metric: string }
 * Response: { results: { id, nom, coverage }[] }
 */
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const RPC_TIMEOUT_MS = 120_000; // 120s — dépasse le timeout client Supabase JS par défaut (~8s)

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const { poiGroups, metric = 'ind' } = await req.json() as {
      poiGroups: { id: string; nom: string; geometries: string[] }[];
      metric?:   string;
    };

    if (!Array.isArray(poiGroups) || poiGroups.length === 0) {
      return NextResponse.json({ error: 'poiGroups[] requis' }, { status: 400 });
    }

    const totalGeoms    = poiGroups.reduce((s, p) => s + p.geometries.length, 0);
    const totalPayloadKB = Math.round(JSON.stringify(poiGroups).length / 1024);
    console.log(`[coverage-breakdown] metric=${metric} | ${poiGroups.length} groupes | ${totalGeoms} géométries | ~${totalPayloadKB}KB payload`);
    for (const p of poiGroups) {
      const geomBytes = p.geometries.reduce((s, g) => s + (g?.length ?? 0), 0);
      console.log(`  → groupe "${p.id}" : ${p.geometries.filter(Boolean).length} géom | ~${Math.round(geomBytes / 1024)}KB`);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Variables Supabase manquantes' }, { status: 500 });
    }

    const groups = poiGroups.map(p => ({
      id:         p.id,
      geometries: p.geometries.filter(Boolean),
    }));

    // ── fetch() direct avec AbortController — contourne le timeout ~8s du client Supabase JS
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

    const tRpc = Date.now();
    console.log(`[coverage-breakdown] → fetch RPC (timeout ${RPC_TIMEOUT_MS / 1000}s)...`);

    let rpcRes: Response;
    try {
      rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/calculate_coverage_per_group`, {
        method:  'POST',
        signal:  controller.signal,
        headers: {
          'Content-Type':  'application/json',
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer':        'return=representation',
        },
        body: JSON.stringify({ p_groups: groups, p_column: metric }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    console.log(`[coverage-breakdown] RPC HTTP ${rpcRes.status} en ${Date.now() - tRpc}ms`);

    if (!rpcRes.ok) {
      const errText = await rpcRes.text().catch(() => `HTTP ${rpcRes.status}`);
      console.error(`[coverage-breakdown] RPC error: ${errText.slice(0, 400)}`);
      // Extraire le message Postgres si dispo
      let errMsg = errText;
      try { errMsg = JSON.parse(errText)?.message ?? errText; } catch { /* */ }
      return NextResponse.json({ error: errMsg.slice(0, 300) }, { status: 500 });
    }

    const rows = await rpcRes.json() as { group_id: string; coverage: number }[];
    console.log(`[coverage-breakdown] ${rows.length} résultats reçus :`);
    for (const r of rows) {
      console.log(`  → "${r.group_id}" : ${Number(r.coverage).toLocaleString('fr-FR')}`);
    }

    const resultMap = new Map<string, number>(rows.map(r => [r.group_id, r.coverage]));

    const results = poiGroups
      .map(p => ({ id: p.id, nom: p.nom, coverage: resultMap.get(p.id) ?? 0 }))
      .sort((a, b) => b.coverage - a.coverage);

    console.log(`[coverage-breakdown] total elapsed: ${Date.now() - t0}ms`);
    return NextResponse.json({ results });

  } catch (e: any) {
    const isTimeout = e?.name === 'AbortError';
    const msg = isTimeout ? `Timeout après ${RPC_TIMEOUT_MS / 1000}s — canceling statement due to statement timeout` : (e.message ?? 'Erreur inconnue');
    console.error(`[coverage-breakdown] ${isTimeout ? 'TIMEOUT' : 'exception'} après ${Date.now() - t0}ms : ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
