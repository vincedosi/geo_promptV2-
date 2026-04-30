/**
 * GET    /api/bidding/strategies/drafts/[id] — load a draft (vérif owner)
 * DELETE /api/bidding/strategies/drafts/[id] — discard a draft (vérif owner)
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
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bidding_strategy_drafts')
    .select('id, user_id, campaign_id, current_step, draft_data, last_saved_at, expires_at, consumed_at, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Draft introuvable' }, { status: 404 });
  if (data.user_id !== profile.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ draft: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  // Vérif owner avant delete
  const { data: existing } = await supabase
    .from('bidding_strategy_drafts')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Draft introuvable' }, { status: 404 });
  if (existing.user_id !== profile.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await supabase.from('bidding_strategy_drafts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: true, id });
}
