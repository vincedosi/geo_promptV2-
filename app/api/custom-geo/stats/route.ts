import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

// Cf. /api/custom-geo/list : Next.js cache les fetch Supabase server-side.
function createNoCacheAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    },
  );
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const orgId = new URL(request.url).searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 });

  const supabase = createNoCacheAdminClient();
  const { data, error } = await supabase.rpc('get_custom_geo_zones_stats', { p_org_id: orgId });

  if (error) {
    console.error('[custom-geo/stats]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    },
  });
}
