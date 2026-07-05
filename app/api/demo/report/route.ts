import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { assertDemo } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';
import { buildCampaignReport } from '@/lib/report/aggregate';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    const report = await buildCampaignReport(supabase, DEMO_CAMPAIGN_ID);
    return NextResponse.json({ report: report ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'report_failed' }, { status: 400 });
  }
}
