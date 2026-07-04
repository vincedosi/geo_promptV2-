import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { assertDemo, simulateCurrentPeriod } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    const { rows } = await simulateCurrentPeriod(supabase);
    return NextResponse.json({ ok: true, delivery_rows: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'simulate_failed' }, { status: 400 });
  }
}
