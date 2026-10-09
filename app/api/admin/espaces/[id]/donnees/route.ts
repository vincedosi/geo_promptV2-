/**
 * GET /api/admin/espaces/[id]/donnees
 * Chaque jeu de données avec son statut POUR cet espace (spec § 4.4).
 *
 * super_admin seul (D1). Réponse bornée par construction (une ligne par
 * source, quelques dizaines, sous le plafond serveur PostgREST de 1 000) :
 * aucune troncature possible.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { donneesDeLEspace } from '@/lib/espaces/donnees-espace';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return NextResponse.json({ error: 'Identifiant d\'espace invalide.' }, { status: 400 });

  try {
    const reponse = await donneesDeLEspace(createAdminClient(), id);
    if (!reponse) return NextResponse.json({ error: 'Espace introuvable.' }, { status: 404 });
    return NextResponse.json(reponse);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}
