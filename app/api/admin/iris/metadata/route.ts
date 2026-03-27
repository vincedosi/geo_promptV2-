import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sb = createAdminClient();
  const { data, error } = await sb.from('iris_metadata').select('key, value');
  if (error) return NextResponse.json({}, { status: 500 });
  const result: Record<string, string> = {};
  for (const row of data ?? []) result[row.key] = row.value;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const sb = createAdminClient();
  const body = await req.json();
  const updates = Object.entries(body as Record<string, string>);
  for (const [key, value] of updates) {
    await sb.from('iris_metadata').upsert({ key, value });
  }
  return NextResponse.json({ success: true });
}
