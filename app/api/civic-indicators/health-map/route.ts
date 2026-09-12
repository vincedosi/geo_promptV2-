/**
 * GET /api/civic-indicators/health-map
 *   ?dataset=pollen|atmo&scale=departement|cp&min_level=0-6&metric=global|<espèce|polluant>&bbox=w,s,e,n
 *
 * Carte santé environnementale (allergènes + qualité de l'air), deux échelles :
 *
 *   scale=departement (défaut) — échantillonnage 1 commune représentative
 *   par département (RPC get_dept_representative_communes) via le pipeline
 *   getHealthWithCache. Streaming NDJSON (progression temps réel), chaque
 *   ligne dept porte pollen ET air (même coût, un seul pipeline) :
 *     {"type":"meta","total":104}
 *     {"type":"dept","code_dept":"22","nom_dept":"...","pollen":{...},"air":{...},"stale":false}
 *     {"type":"done","fetched":100,"failed":4}
 *
 *   scale=cp — lit pollen_map_daily / atmo_map_daily (ingestion bulk WFS
 *   nationale, niveaux max des communes du CP). Filtre SQL min_level sur la
 *   métrique demandée, et `bbox` optionnelle (Tâche 4, corrigée round 1,
 *   2026-09-12) sur les codes postaux resolus par la RPC PostGIS
 *   `codes_postaux_dans_bbox` (sql/144) — PAS un filtre direct sur
 *   `ref_codes_postaux.centroid_lat/centroid_lon`, qui sont NULL sur les
 *   6187 lignes (colonne reellement peuplee : `centroid`, geometry, GIST).
 *   Sans `bbox`, comportement d'avant : lecture nationale complète
 *   (~6 200 lignes, léger). JSON :
 *     {"date":"2026-07-03","rows":[{"code_postal":"29200","indice_global":4,...}]}
 *     ou {"date":null,"rows":[],"error":"no_data"} si l'ingestion n'a jamais tourné.
 *
 * min_level/metric ne s'appliquent qu'à scale=cp (au département, le filtre
 * est côté client — les ~104 valeurs sont déjà chargées). `bbox` ne s'applique
 * qu'à scale=cp egalement (le département n'a pas de notion de bbox).
 *
 * Source : Atmo France et les AASQA — licence ODbL (mention obligatoire côté UI).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { getHealthWithCache } from '@/lib/civic-health/get-health';

export const dynamic = 'force-dynamic';

/** Concurrence des lookups dept (cache DB + API Atmo) — reste sous la limite Nano. */
const CONCURRENCY = 3;

const POLLEN_METRICS = ['global', 'ambroisie', 'armoise', 'aulne', 'bouleau', 'graminees', 'olivier'] as const;
const ATMO_METRICS = ['global', 'no2', 'o3', 'pm10', 'pm25', 'so2'] as const;

const querySchema = z.object({
  dataset: z.enum(['pollen', 'atmo']).default('pollen'),
  scale: z.enum(['departement', 'cp']).default('departement'),
  min_level: z.coerce.number().int().min(0).max(6).default(0),
  metric: z.string().default('global'),
  // [west, south, east, north] — lib/carte/filtre.ts (Tache 4). Ne s'applique
  // qu'a scale=cp ; ignore sur scale=departement (echantillon national fixe).
  bbox: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/).optional(),
});

const CP_TABLES = {
  pollen: {
    table: 'pollen_map_daily',
    columns: 'code_postal, indice_global, ambroisie, armoise, aulne, bouleau, graminees, olivier, '
      + 'conc_ambroisie, conc_armoise, conc_aulne, conc_bouleau, conc_graminees, conc_olivier, alerte, nb_communes',
  },
  atmo: {
    table: 'atmo_map_daily',
    columns: 'code_postal, indice_global, no2, o3, pm10, pm25, so2, nb_communes',
  },
} as const;

interface DeptRow {
  code_dept: string;
  nom_dept: string;
  code_commune: string;
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }
  const { dataset, scale, min_level, metric, bbox } = parsed.data;
  const validMetrics: readonly string[] = dataset === 'pollen' ? POLLEN_METRICS : ATMO_METRICS;
  if (!validMetrics.includes(metric)) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }
  const levelColumn = metric === 'global' ? 'indice_global' : metric;

  const supabase = createAdminClient();

  // ── Échelle code postal : lecture table quotidienne (ingestion bulk WFS) ──
  if (scale === 'cp') {
    const { table, columns } = CP_TABLES[dataset];
    // Date la plus récente disponible (aujourd'hui, sinon la veille si le cron
    // du matin n'a pas encore tourné)
    const { data: latest, error: latestErr } = await supabase
      .from(table)
      .select('date_ech')
      .order('date_ech', { ascending: false })
      .limit(1);
    if (latestErr) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    const date = latest?.[0]?.date_ech ?? null;
    if (!date) {
      return NextResponse.json({ date: null, rows: [], error: 'no_data' });
    }

    // bbox (Tache 4, corrigee round 1) : resout d'abord les codes postaux dont
    // le centroide tombe dans la bbox via la RPC `codes_postaux_dans_bbox`
    // (sql/144). `ref_codes_postaux.centroid_lat`/`centroid_lon` sont NULL sur
    // les 6187 lignes — un `.gte()` dessus ne matche jamais rien et rendait
    // silencieusement `rows: []` en toutes circonstances. La colonne qui porte
    // reellement l'information est `centroid` (geometry, indexee GIST) : la
    // RPC l'interroge en PostGIS (`&&` sur ST_MakeEnvelope). Jamais un masque
    // cote client.
    let codesPostauxBbox: string[] | null = null;
    if (bbox) {
      const [west, south, east, north] = bbox.split(',').map(Number);
      const { data: cps, error: cpsErr } = await supabase
        .rpc('codes_postaux_dans_bbox', { p_ouest: west, p_sud: south, p_est: east, p_nord: north });
      if (cpsErr) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
      codesPostauxBbox = ((cps ?? []) as { code_postal: string }[]).map(c => c.code_postal);
      if (codesPostauxBbox.length === 0) {
        return NextResponse.json({ date, rows: [] }, { headers: { 'Cache-Control': 'no-store' } });
      }
    }

    let query = supabase
      .from(table)
      .select(columns)
      .eq('date_ech', date)
      .gte(levelColumn, Math.max(min_level, 1)); // 0 = indisponible, jamais peint
    if (codesPostauxBbox) {
      query = query.in('code_postal', codesPostauxBbox);
    }
    const { data: rows, error: rowsErr } = await query.limit(10_000);
    if (rowsErr) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    return NextResponse.json(
      { date, rows: rows ?? [] },
      // no-store : le flux no_data → ingestion admin → refetch doit voir la
      // donnée fraîche immédiatement (un max-age ferait rejouer le no_data
      // depuis le cache navigateur). Lecture SQL indexée (PK date) — léger.
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // ── Échelle département : échantillonnage streaming (pollen + air) ────────
  const { data: depts, error } = await supabase.rpc('get_dept_representative_communes') as {
    data: DeptRow[] | null;
    error: { message: string } | null;
  };
  if (error || !depts) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      send({ type: 'meta', total: depts.length });

      let fetched = 0;
      let failed = 0;
      let cursor = 0;

      const worker = async () => {
        while (cursor < depts.length) {
          const dept = depts[cursor++];
          try {
            const { data } = await getHealthWithCache(dept.code_commune.toUpperCase());
            if (data?.pollen || data?.air) {
              fetched++;
              send({
                type: 'dept',
                code_dept: dept.code_dept,
                nom_dept: dept.nom_dept,
                pollen: data.pollen,
                air: data.air,
                stale: data.stale,
              });
            } else {
              failed++;
              send({ type: 'dept', code_dept: dept.code_dept, nom_dept: dept.nom_dept, pollen: null, air: null });
            }
          } catch {
            failed++;
            send({ type: 'dept', code_dept: dept.code_dept, nom_dept: dept.nom_dept, pollen: null, air: null });
          }
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      send({ type: 'done', fetched, failed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
