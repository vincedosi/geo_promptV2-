import { createAdminClient } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function POST() {
  const supabase = createAdminClient();

  const { error, count } = await supabase
    .from('isochrones_cache')
    .delete({ count: 'exact' })
    .neq('cache_key', ''); // delete all rows

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: count });
}
