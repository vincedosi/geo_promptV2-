/**
 * GET /api/admin/espaces/[id]/membres
 * Les membres d'un espace, avec leurs autres espaces (spec § 4.3).
 *
 * super_admin seul (D1). Réponse bornée par construction (quelques dizaines
 * de membres, sous le plafond serveur PostgREST de 1 000) : aucune troncature
 * possible.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { membresDeLEspace, resumerEspace } from '@/lib/espaces/lister-espaces';

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
    return NextResponse.json({ membres: await membresDeLEspace(sb, id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}
