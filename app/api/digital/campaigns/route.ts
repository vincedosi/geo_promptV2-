/**
 * GET /api/digital/campaigns
 * List DSP campaigns scoped by user's organization.
 * super_admin with no org → all campaigns
 * user with org → only their org's campaigns
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserFromRequest, isSuperAdmin } from '@/lib/auth';

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

export async function GET(request: NextRequest) {
  const supabase = createNoCacheClient();

  // Get user profile for org scoping
  const authHeader = request.headers.get('authorization');
  const profile = await getUserFromRequest(authHeader);

  // Determine org filter
  let orgId: string | null = null;
  if (profile && !isSuperAdmin(profile)) {
    // Non-admin users only see their org's campaigns
    orgId = profile.organization_id;
  } else if (profile && isSuperAdmin(profile) && profile.organization_id) {
    // Super admin with an org sees all (orgId stays null)
    orgId = null;
  }

  const { data, error } = await supabase.rpc('get_digital_campaigns_list', {
    p_organization_id: orgId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = typeof data === 'string' ? JSON.parse(data) : (data ?? []);
  return NextResponse.json(rows, { headers: { 'Cache-Control': 'no-store' } });
}
