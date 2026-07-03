/**
 * GET  /api/bidding/strategies/drafts
 *   → liste les drafts de l'utilisateur courant (consumed_at IS NULL)
 *
 * POST /api/bidding/strategies/drafts
 *   → upsert (user_id, campaign_id) — appelé par le hook autosave (debounce 1s)
 *   Body : { campaign_id, current_step, draft_data }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const DraftUpsertSchema = z.object({
  campaign_id: z.string().uuid(),
  current_step: z.number().int().min(1).max(5),
  draft_data: z.record(z.unknown()),
});

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const supabase = createAdminClient();
  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaign_id');

  let query = supabase
    .from('bidding_strategy_drafts')
    .select('id, campaign_id, current_step, draft_data, last_saved_at, expires_at, created_at')
    .eq('user_id', profile.id)
    .is('consumed_at', null)
    .order('last_saved_at', { ascending: false });

  if (campaignId) query = query.eq('campaign_id', campaignId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ drafts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }

  const parsed = DraftUpsertSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('bidding_strategy_drafts')
    .upsert({
      user_id: profile.id,
      campaign_id: body.campaign_id,
      current_step: body.current_step,
      draft_data: body.draft_data,
      last_saved_at: now,
      consumed_at: null,
    }, { onConflict: 'user_id,campaign_id' })
    .select('id, current_step, last_saved_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'upsert failed' }, { status: 500 });
  }
  return NextResponse.json({ draft: data });
}
