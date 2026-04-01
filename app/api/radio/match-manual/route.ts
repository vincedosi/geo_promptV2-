/**
 * POST /api/radio/match-manual
 * Manual matching of orphan emitters to radios. Super-admin only.
 * Body: { matches: [{ emetteur_id: UUID, radio_id: UUID }, ...] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  matches: z.array(z.object({
    emetteur_id: z.string().uuid(),
    radio_id: z.string().uuid(),
  })).min(1).max(500),
});

export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join(', ') }, { status: 400 });
  }

  const supabase = createAdminClient();
  let updated = 0;

  for (const m of parsed.data.matches) {
    const { error } = await supabase
      .from('emetteurs_radio')
      .update({ radio_id: m.radio_id })
      .eq('id', m.emetteur_id);
    if (!error) updated++;
  }

  return NextResponse.json({ success: true, updated, total: parsed.data.matches.length });
}
