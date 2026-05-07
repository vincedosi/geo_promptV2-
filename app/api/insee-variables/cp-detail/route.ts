/**
 * GET /api/insee-variables/cp-detail?cp=75001
 *
 * Retourne le nom de la commune principale d'un code postal et le nombre de
 * communes associées. Utilisé par le popup click du layer Indicateurs civiques
 * pour afficher "Paris 1er", "Saint-Denis", etc. au lieu d'un simple "75001".
 *
 * Cache aggressif (1 jour) : data La Poste statique.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const url = new URL(request.url);
  const cp = url.searchParams.get('cp');
  if (!cp || !/^[0-9A-Z]{4,6}$/.test(cp)) {
    return NextResponse.json({ error: 'invalid_cp' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('postal_code_commune')
    .select('nom_commune')
    .eq('code_postal', cp);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const communes = (data ?? []).map(r => r.nom_commune as string).filter(Boolean);
  return NextResponse.json(
    {
      code_postal: cp,
      commune_principale: communes[0] ?? null,
      nb_communes: communes.length,
      communes,
    },
    { headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
