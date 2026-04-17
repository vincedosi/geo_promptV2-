/**
 * POST /api/radio/import-anfr
 * Lance l'import ANFR — streaming NDJSON de progression.
 * Super-admin uniquement.
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { importAnfrData } from '@/lib/radio/anfr-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — ZIP ANFR ~64 Mo

export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();

  // Check no import already running
  const { data: running } = await supabase
    .from('radio_imports_log')
    .select('id')
    .eq('type', 'anfr')
    .eq('status', 'running')
    .limit(1);

  if (running && running.length > 0) {
    return Response.json(
      { error: 'Un import ANFR est déjà en cours.' },
      { status: 409 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { /* closed */ }
      };

      try {
        await importAnfrData(supabase, send);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
