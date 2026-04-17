/**
 * GET /api/radio/emetteurs/[staAnfr]
 * Detail of a single emitter with ALL associated radios (many-to-many).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { staAnfr: string } },
) {
  const profile = await requireAuth(req);
  if (!profile) return authUnauthorized();
  const { staAnfr } = params;
  const supabase = createAdminClient();

  // Get emitter
  const { data: emetteur, error } = await supabase
    .from('emetteurs_radio')
    .select('*')
    .eq('sta_nm_anfr', staAnfr)
    .single();

  if (error || !emetteur) {
    return NextResponse.json({ error: 'Emetteur non trouve' }, { status: 404 });
  }

  // Get all radios via junction table
  const { data: radios } = await supabase
    .rpc('get_radios_for_emetteur', { p_emetteur_id: emetteur.id });

  return NextResponse.json({
    ...emetteur,
    radios: radios ?? [],
    nb_radios: (radios ?? []).length,
  });
}
