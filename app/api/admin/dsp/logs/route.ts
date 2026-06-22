/** MAGELIAN — GET /api/admin/dsp/logs : logs DSP de l'org (filtres provider/level, pagination). */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { logsQuerySchema } from '@/lib/dsp/validation';
import type { DspApiLogRow } from '@/types/dsp';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const url = new URL(request.url);
  const parsed = logsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }
  const { provider, level, limit, offset } = parsed.data;

  const supabase = createAdminClient();
  let query = supabase
    .from('dsp_api_logs')
    .select('id, provider, category, level, action, status_code, duration_ms, message, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (provider) query = query.eq('provider', provider);
  if (level) query = query.eq('level', level);

  const { data, error } = await query;
  if (error) {
    console.error('[GET dsp/logs]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  return NextResponse.json({ logs: (data ?? []) as DspApiLogRow[] }, { headers: { 'Cache-Control': 'no-store' } });
}
