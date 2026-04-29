/**
 * GET /api/bidding/strategies/[id]/comparison
 *
 * Query params : ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&date=YYYY-MM-DD (single)
 * Renvoie les rows par CP × jour (réel vs simulé) via la RPC get_strategy_comparison_data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const { searchParams } = new URL(request.url);

  const single = searchParams.get('date');
  const dateFrom = single ?? searchParams.get('date_from');
  const dateTo = single ?? searchParams.get('date_to');

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_strategy_comparison_data', {
    p_strategy_id: id,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [], date_from: dateFrom, date_to: dateTo });
}
