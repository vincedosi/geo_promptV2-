import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('dsp_campaigns')
      .select('id, name, created_at');

    return NextResponse.json({
      ok: true,
      count: data?.length ?? 0,
      campaigns: data,
      error: error?.message ?? null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
