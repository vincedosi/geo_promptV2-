import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { applyRebid } from '@/lib/demo/controller';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    const res = await applyRebid(supabase, profile.id);
    return NextResponse.json({ ok: true, version: res.version, delivery_rows: res.delivery_rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'rebid_failed' }, { status: 400 });
  }
}
