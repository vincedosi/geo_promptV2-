import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_equity_indicators');
    if (error) {
      console.error('[equity-indicators] error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    console.error('[equity-indicators] unexpected:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
