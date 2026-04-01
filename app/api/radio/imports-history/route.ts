/**
 * GET /api/radio/imports-history
 * 50 derniers imports radio depuis radio_imports_log.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('radio_imports_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ imports: data ?? [] });
}
