/**
 * GET /api/bidding/strategies/[id]/changes
 *   → audit trail complet d'une stratégie (strategy_changes joinée auth.users.email)
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

  const { data: changes, error } = await supabase
    .from('strategy_changes')
    .select('id, change_type, field_path, old_value, new_value, reason, triggered_by, user_id, created_at')
    .eq('strategy_id', id)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrichir avec l'email user (1 lookup batch via auth.admin)
  const userIds = Array.from(new Set((changes ?? []).map(c => c.user_id).filter(Boolean) as string[]));
  const emailByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', userIds);
    for (const p of profilesData ?? []) {
      if (p.email) emailByUserId.set(p.id, p.email);
    }
  }

  const enriched = (changes ?? []).map(c => ({
    ...c,
    user_email: c.user_id ? emailByUserId.get(c.user_id) ?? null : null,
  }));

  return NextResponse.json({ changes: enriched, total: enriched.length });
}
