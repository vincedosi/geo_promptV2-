/**
 * GET /api/digital/campaigns
 * List DSP campaigns with enriched metadata (nb_medias, nb_postal_codes).
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

  const { data, error } = await supabase.rpc('get_digital_campaigns_list');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = typeof data === 'string' ? JSON.parse(data) : (data ?? []);
  return NextResponse.json(rows, { headers: { 'Cache-Control': 'no-store' } });
}
