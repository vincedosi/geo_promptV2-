/**
 * POST /api/admin/civic-ingest
 *
 * Déclenche l'ingestion nationale santé environnementale (pollen + qualité
 * de l'air ATMO) → pollen_map_daily + atmo_map_daily, via le GeoServer WFS
 * public Atmo. Réponse NDJSON streaming — chaque ligne est un
 * CivicIngestProgress, la dernière porte {type:'done', summary} ou
 * {type:'error', message}.
 *
 * Le cron Inngest `civic-daily-ingest` fait la même chose chaque matin ;
 * cette route sert au premier remplissage et aux rejeux manuels.
 */
import { NextRequest } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { runCivicIngest } from '@/lib/civic-health/civic-ingest';

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
        const summary = await runCivicIngest(p => send({ type: 'progress', ...p }));
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
