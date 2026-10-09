/**
 * GET /api/admin/espaces/[id]/apercu
 * Ce que voit cet espace (spec § 4.5) : la règle des routes, appelée.
 *
 * super_admin seul (D1). Réponse bornée par construction (jeux : une ligne par
 * source, sous le plafond serveur PostgREST de 1 000 ; catégories : liste
 * courte sans effectif) : aucune troncature possible. Aucun COUNT sur
 * poi_france.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { apercuEspace } from '@/lib/espaces/apercu-espace';
import { resumerEspace } from '@/lib/espaces/lister-espaces';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return NextResponse.json({ error: 'Identifiant d\'espace invalide.' }, { status: 400 });

  try {
    const sb = createAdminClient();
    if (!(await resumerEspace(sb, id))) return NextResponse.json({ error: 'Espace introuvable.' }, { status: 404 });
    return NextResponse.json(await apercuEspace(sb, id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}
