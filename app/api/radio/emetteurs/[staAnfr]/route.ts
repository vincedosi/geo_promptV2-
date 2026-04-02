/**
 * GET /api/radio/emetteurs/[staAnfr]
 * Detail of a single emitter with associated radio info.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { staAnfr: string } },
) {
  const { staAnfr } = params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('emetteurs_radio')
    .select(`
      *, radios(id, nom, categorie_arcom, portee, genre, groupe_media)
    `)
    .eq('sta_nm_anfr', staAnfr)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Émetteur non trouvé' }, { status: 404 });
  }

  return NextResponse.json(data);
}
