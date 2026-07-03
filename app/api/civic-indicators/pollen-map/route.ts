/**
 * GET /api/civic-indicators/pollen-map
 *
 * Carte des allergènes : indice pollen par département (choroplèthe).
 * Échantillonnage : une commune représentative par département (RPC
 * get_dept_representative_communes), indicateur via le pipeline partagé
 * getHealthWithCache (cache Supabase 24h par commune → l'API Atmo n'est
 * interrogée qu'une fois par jour et par département).
 *
 * Streaming NDJSON (progression temps réel — premier chargement du jour
 * ≈ 100 appels Atmo, concurrence 3) :
 *   {"type":"meta","total":104}
 *   {"type":"dept","code_dept":"22","nom_dept":"Cotes-d-Armor","pollen":{...},"stale":false}
 *   {"type":"done","fetched":100,"failed":4}
 *
 * Source : Atmo France et les AASQA — licence ODbL (mention obligatoire côté UI).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { getHealthWithCache } from '@/lib/civic-health/get-health';

export const dynamic = 'force-dynamic';

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

  const supabase = createAdminClient();
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
