/**
 * @file app/api/risques/exposition/cibles/route.ts
 *
 * Le catalogue des cibles calculables (`cibles_exposition`, sql/185).
 *
 * ── POURQUOI CETTE ROUTE EXISTE PLUTÔT QU'UN TABLEAU DANS LE COMPOSANT ────
 *
 * Règle du projet : rien en dur. Le menu de l'overlay se construit depuis la
 * base, donc ajouter ou retirer une cible ne demande pas de déploiement — et
 * surtout, le menu ne peut pas proposer une cible que la RPC refuserait. La
 * validation et l'affichage lisent la MÊME table.
 *
 * ── CE QUE LE CATALOGUE NE CONTIENT PAS, ET POURQUOI ─────────────────────
 *
 * Aucun taux. Que des effectifs. On peut prendre 30 % des habitants d'un
 * carreau ; on ne peut pas prendre 30 % d'un revenu médian. Les taux (part de
 * ménages pauvres, revenu moyen) se calculent APRÈS agrégation, à partir de
 * deux effectifs — jamais par prorata de surface.
 *
 * Cache d'un jour : la table ne change qu'à une migration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('cibles_exposition')
    .select('code, libelle, famille, ordre')
    .eq('actif', true)
    .order('ordre');

  if (error) {
    console.error('[risques/exposition/cibles]', error.message);
    return NextResponse.json({ error: 'Catalogue indisponible.' }, { status: 500 });
  }

  return NextResponse.json(
    { cibles: data ?? [] },
    { headers: { 'Cache-Control': 'private, max-age=86400' } },
  );
}
