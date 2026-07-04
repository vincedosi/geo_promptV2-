import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { assertDemo, purgeDemo, createPeriodSnapshot, simulateCurrentPeriod } from '@/lib/demo/controller';
import { ensureDemoPlan } from '@/lib/demo/fixtures';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    await purgeDemo(supabase);
    const { items } = await ensureDemoPlan(supabase, profile.id);
    const version = await createPeriodSnapshot(supabase, profile.id, items, 1);
    await simulateCurrentPeriod(supabase);
    return NextResponse.json({ ok: true, version });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'reset_failed' }, { status: 400 });
  }
}
