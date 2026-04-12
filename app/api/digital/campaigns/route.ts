/**
 * GET /api/digital/campaigns
 * List DSP campaigns with basic stats.
 * Auth: getSession() (JWT local, no network call)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function createNoCacheClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }) },
    }
  );
}

export async function GET() {
  const supabase = createNoCacheClient();

  const { data, error } = await supabase
    .from('dsp_campaigns')
    .select('id, name, dsp_source, advertiser, date_start, date_end, countries, total_tracked_ads, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? [], {
    headers: { 'Cache-Control': 'no-store' },
  });
}
