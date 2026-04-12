/**
 * GENESIS — POST /api/admin/campaigns/[id]/match-iris
 * Re-run IRIS matching for a specific campaign.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: matched, error } = await supabase
    .rpc('match_campaign_postal_to_iris', { p_campaign_id: id });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, matched: matched ?? 0 });
}
