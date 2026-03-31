import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();
  const sb = createAdminClient();

  const { error, count } = await sb.from('iris').delete({ count: 'exact' }).neq('code_iris', '');
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, deleted: count });
}
