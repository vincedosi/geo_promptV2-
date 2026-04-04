/**
 * GET /api/radio/filter-options
 * Returns categories, groups, and radios with emitters for filter dropdowns.
 * Cached 60s — data changes only after enrichment.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_radio_filter_options');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
