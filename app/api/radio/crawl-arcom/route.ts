/**
 * POST /api/radio/crawl-arcom
 * Lance le matching radios → émetteurs. Super-admin uniquement.
 * Streaming NDJSON de progression.
 */
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { crawlAndMatchRadios } from '@/lib/radio/arcom-crawler';
import { toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Plafond Vercel plan Hobby (900 refusé au build). Crawl complet ~1000 radios : relancer en local si timeout.

export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();

  // Check no crawl already running
  const { data: running } = await supabase
    .from('radio_imports_log')
    .select('id')
    .eq('type', 'arcom')
    .eq('status', 'running')
    .limit(1);

  if (running && running.length > 0) {
    return Response.json({ error: 'Un crawl Arcom est déjà en cours.' }, { status: 409 });
  }

  // Create log entry
  const { data: logData } = await supabase
    .from('radio_imports_log')
    .insert({ type: 'arcom', status: 'running' })
    .select('id')
    .single();
  const logId = logData?.id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { /* closed */ }
      };

      try {
        const result = await crawlAndMatchRadios(supabase, send, logId!);

        if (logId) {
          await supabase.from('radio_imports_log').update({
            status: 'success',
            completed_at: new Date().toISOString(),
            stats: toJson(result),
          }).eq('id', logId);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message: msg });

        if (logId) {
          await supabase.from('radio_imports_log').update({
            status: 'error',
            completed_at: new Date().toISOString(),
            error_message: msg,
          }).eq('id', logId);
        }
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
