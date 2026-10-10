/**
 * GET /api/admin/espaces/comptes
 * Tous les comptes, avec tous leurs espaces : vue « Tous les comptes » de la
 * page Accès (2026-10-10), seule à atteindre un compte rattaché à aucun espace.
 *
 * super_admin seul (D1). Profils et appartenances lus page par page
 * (`lireTout`, plafond PostgREST de 1 000 lignes par requête de table) ; au-delà
 * de `PLAFOND_COMPTES` (10 000) la route répond 500 plutôt qu'une liste
 * tronquée. Pas de paramètre : rien à valider.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { listerComptes } from '@/lib/espaces/lister-comptes';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  try {
    return NextResponse.json({ comptes: await listerComptes(createAdminClient()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}
