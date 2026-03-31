import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { data, error } = await sb.from('iris_metadata').select('key, value');
  if (error) return NextResponse.json({}, { status: 500 });
  const result: Record<string, string> = {};
  for (const row of data ?? []) result[row.key] = row.value;
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const body = await req.json();
  const updates = Object.entries(body as Record<string, string>);
  for (const [key, value] of updates) {
    await sb.from('iris_metadata').upsert({ key, value });
  }
  return NextResponse.json({ success: true });
}
