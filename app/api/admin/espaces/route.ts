/**
 * GET /api/admin/espaces
 * Les espaces de travail avec leurs compteurs, et l'entrée Socle.
 *
 * super_admin seul (D1). Réponse bornée par construction (quelques dizaines
 * de lignes, sous le plafond serveur PostgREST de 1 000) : aucune troncature
 * possible.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { listerEspaces } from '@/lib/espaces/lister-espaces';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  try {
    return NextResponse.json(await listerEspaces(createAdminClient()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}
