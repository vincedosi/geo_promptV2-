/**
 * GET /api/admin/espaces/socle
 * Tous les jeux de données (fiche Socle, spec § 4.2) et le nombre d'espaces
 * clients qui perdraient un jeu retiré du socle.
 *
 * Segment fixe à côté de `[id]` : Next résout le segment statique en premier.
 * super_admin seul (D1). Réponse bornée par construction (une ligne par
 * source, sous le plafond serveur PostgREST de 1 000) : aucune troncature.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { lireSocle } from '@/lib/espaces/donnees-espace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  try {
    return NextResponse.json(await lireSocle(createAdminClient()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}
