/**
 * POST /api/bidding/proposals/[id]/reject
 *
 * Body : { notes?: string }
 * Marque la proposition comme rejected (pas d'écriture dans bidding_zone_configs).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'admin requis' }, { status: 403 });
  }

  const { id } = await params;
  let notes: string | undefined;
  try {
    const body = await request.json();
    notes = typeof body?.notes === 'string' ? body.notes : undefined;
  } catch {
    /* body optionnel */
  }

  const supabase = createAdminClient();
  const { data: prop } = await supabase
    .from('bidding_zone_config_proposals')
    .select('status, strategy_id')
    .eq('id', id)
    .single();
  if (!prop) {
    return NextResponse.json({ error: 'Proposition introuvable' }, { status: 404 });
  }

  const access = await checkStrategyAccess(supabase, profile, prop.strategy_id);
  if (access !== 'ok') return NextResponse.json({ error: 'Proposition introuvable' }, { status: 404 });

  if (prop.status !== 'pending') {
    return NextResponse.json(
      { error: `Proposition en status=${prop.status} (attendu: pending)` },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from('bidding_zone_config_proposals')
    .update({
      status: 'rejected',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      review_notes: notes ?? null,
    })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ proposal_id: id, status: 'rejected' });
}
