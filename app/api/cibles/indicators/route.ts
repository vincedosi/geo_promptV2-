/**
 * GET /api/cibles/indicators — catalogue des indicateurs ciblables (registre).
 *
 * Depuis sql/288 (lot « Catalogue et groupes », A-6) : rend les SEULS indicateurs visibles de l'espace actif
 * (`indicateursVisibles`), chacun avec `origine` — `espace` si sa source est privée à l'espace (possédée ou
 * partagée), `commune` sinon. React ignore ce champ ; Angular range ② avec.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { indicateursVisibles } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const supabase = createAdminClient();
  const [{ data, error }, { visibles, propres, echec }] = await Promise.all([
    supabase
      .from('cible_indicator_registry')
      .select('indicator_code, label, famille, unit, slider_min, slider_max, slider_step, default_operator, scale, dynamic')
      .eq('active', true)
      .order('famille')
      .order('label'),
    indicateursVisibles(request),
  ]);
  // Une règle illisible ne se dit pas « aucun indicateur » : 500, comme l'échec de la lecture du registre.
  if (error || echec) {
    console.error('[cibles/indicators]', error?.message ?? 'indicateurs visibles illisibles');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  const indicators = (data ?? [])
    .filter((i) => visibles.has(i.indicator_code))
    .map((i) => ({ ...i, origine: propres.has(i.indicator_code) ? 'espace' as const : 'commune' as const }));
  return NextResponse.json({ indicators });
}
