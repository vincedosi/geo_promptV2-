/**
 * GET /api/civic-indicators/pollen-map?scale=departement|cp&min_level=0-6&espece=global|<espèce>
 *
 * Carte des allergènes, deux échelles :
 *
 *   scale=departement (défaut) — échantillonnage 1 commune représentative
 *   par département (RPC get_dept_representative_communes) via le pipeline
 *   getHealthWithCache. Streaming NDJSON (progression temps réel) :
 *     {"type":"meta","total":104}
 *     {"type":"dept","code_dept":"22","nom_dept":"...","pollen":{...},"stale":false}
 *     {"type":"done","fetched":100,"failed":4}
 *
 *   scale=cp — lit pollen_map_daily (ingestion bulk nationale, niveaux max
 *   des communes du CP). Filtre SQL min_level sur l'espèce demandée. JSON :
 *     {"date":"2026-07-03","rows":[{"code_postal":"29200","indice_global":4,...}]}
 *     ou {"date":null,"rows":[],"error":"no_data"} si l'ingestion n'a jamais tourné.
 *
 * min_level/espece ne s'appliquent qu'à scale=cp (au département, le filtre
 * est côté client — les 104 valeurs sont déjà chargées).
 *
 * Source : Atmo France et les AASQA — licence ODbL (mention obligatoire côté UI).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { getHealthWithCache } from '@/lib/civic-health/get-health';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  scale: z.enum(['departement', 'cp']).default('departement'),
  min_level: z.coerce.number().int().min(0).max(6).default(0),
  espece: z
    .enum(['global', 'ambroisie', 'armoise', 'aulne', 'bouleau', 'graminees', 'olivier'])
    .default('global'),
});

/** Colonne SQL portant le niveau filtré (indice global ou une espèce). */
function levelColumn(espece: string): string {
  return espece === 'global' ? 'indice_global' : espece;
}

/** Concurrence des lookups (cache DB + API Atmo) — reste sous la limite Nano. */
const CONCURRENCY = 3;

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
  const { scale, min_level, espece } = parsed.data;

  const supabase = createAdminClient();

  // ── Échelle code postal : lecture pollen_map_daily (ingestion bulk) ───────
  if (scale === 'cp') {
    // Date la plus récente disponible (aujourd'hui, sinon la veille si le cron
    // du matin n'a pas encore tourné)
    const { data: latest, error: latestErr } = await supabase
      .from('pollen_map_daily')
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
    const { data: rows, error: rowsErr } = await supabase
      .from('pollen_map_daily')
      .select('code_postal, indice_global, ambroisie, armoise, aulne, bouleau, graminees, olivier, nb_communes')
      .eq('date_ech', date)
      .gte(levelColumn(espece), Math.max(min_level, 1)) // 0 = indisponible, jamais peint
      .limit(10_000);
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

  // ── Échelle département : échantillonnage streaming (comportement historique) ──
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
            if (data?.pollen) {
              fetched++;
              send({
                type: 'dept',
                code_dept: dept.code_dept,
                nom_dept: dept.nom_dept,
                pollen: data.pollen,
                stale: data.stale,
              });
            } else {
              failed++;
              send({ type: 'dept', code_dept: dept.code_dept, nom_dept: dept.nom_dept, pollen: null });
            }
          } catch {
            failed++;
            send({ type: 'dept', code_dept: dept.code_dept, nom_dept: dept.nom_dept, pollen: null });
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
