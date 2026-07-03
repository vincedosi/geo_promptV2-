/**
 * POST /api/admin/pollen-ingest
 *
 * Déclenche l'ingestion nationale pollen → pollen_map_daily (bulk Atmo ou
 * mock selon ATMO_PROVIDER). Réponse NDJSON streaming — chaque ligne est un
 * PollenIngestProgress, la dernière porte {type:'done', summary} ou
 * {type:'error', message}.
 *
 * Le cron Inngest `pollen-daily-ingest` fait la même chose chaque matin ;
 * cette route sert au premier remplissage et aux rejeux manuels.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { runPollenIngest } from '@/lib/civic-health/pollen-ingest';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Guard AVANT la création du stream (une 403 en NDJSON serait illisible)
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        const summary = await runPollenIngest(p => send({ type: 'progress', ...p }));
        send({ type: 'done', summary });
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'unknown' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
