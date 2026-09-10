/**
 * GET /api/radio/import-logs/[logId]
 * Returns all log entries for a specific import.
 * Query params: level (filter), phase (filter)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ logId: string }> },
) {
  const profile = await requireAuth(req);
  if (!profile) return authUnauthorized();
  const { logId } = await params;
  const level = req.nextUrl.searchParams.get('level');
  const phase = req.nextUrl.searchParams.get('phase');

  const supabase = createAdminClient();

  // Get the import metadata
  const { data: importData, error: importErr } = await supabase
    .from('radio_imports_log')
    .select('*')
    .eq('id', logId)
    .single();

  if (importErr || !importData) {
    return NextResponse.json({ error: 'Import non trouvé' }, { status: 404 });
  }

  // Get log entries
  let query = supabase
    .from('radio_import_log_entries')
    .select('timestamp, level, phase, message, details, duration_ms')
    .eq('import_log_id', logId)
    .order('timestamp', { ascending: true })
    .limit(500);

  if (level) query = query.eq('level', level);
  if (phase) query = query.eq('phase', phase);

  const { data: entries, error: entriesErr } = await query;

  if (entriesErr) {
    return NextResponse.json({ error: entriesErr.message }, { status: 500 });
  }

  return NextResponse.json({
    import: importData,
    entries: entries ?? [],
  });
}
