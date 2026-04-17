/**
 * GET /api/digital/[campaignId]/media
 * Returns distinct media/régie values for a campaign.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('dsp_campaign_data')
    .select('media')
    .eq('campaign_id', campaignId)
    .not('media', 'is', null)
    .neq('media', '');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const unique = [...new Set((data ?? []).map(r => r.media as string))].sort();

  return NextResponse.json(unique, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
