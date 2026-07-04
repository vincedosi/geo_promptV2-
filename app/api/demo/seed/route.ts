import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';
import { ensureDemoCampaign, ensureDemoPlan } from '@/lib/demo/fixtures';
import { createPeriodSnapshot, simulateCurrentPeriod, purgeDemo, assertDemo } from '@/lib/demo/controller';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await ensureDemoCampaign(supabase);
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    await purgeDemo(supabase);                                    // repart propre
    const { items } = await ensureDemoPlan(supabase, profile.id);
    const version = await createPeriodSnapshot(supabase, profile.id, items, 1);
    const { rows } = await simulateCurrentPeriod(supabase);
    return NextResponse.json({ ok: true, version, delivery_rows: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'seed_failed' }, { status: 400 });
  }
}
