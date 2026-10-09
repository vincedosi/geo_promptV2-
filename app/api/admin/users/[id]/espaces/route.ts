/**
 * PUT /api/admin/users/[id]/espaces
 * Remplace les espaces d'un utilisateur et son espace actif (fiche
 * utilisateur de la page « Espaces de travail », spec § 4.3).
 *
 * super_admin seul (D1). Une seule transaction (RPC sql/236).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { lireCorps } from '@/lib/api/valider-corps';
import { remplacerEspaces } from '@/lib/espaces/appartenance';

export const dynamic = 'force-dynamic';

/** 50 au plus : une liste bornée (règle « jamais de liste illimitée »). */
const EspacesSchema = z.object({
  espaces: z.array(z.string().uuid()).max(50).refine((l) => new Set(l).size === l.length, 'Espace en double.'),
  espace_actif: z.string().uuid().nullable(),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Identifiant d\'utilisateur invalide.' }, { status: 400 });
  const corps = await lireCorps(request, EspacesSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const r = await remplacerEspaces(createAdminClient(), id, corps.valeur.espaces, corps.valeur.espace_actif);
  if (!r.ok) return NextResponse.json({ error: r.message }, { status: r.status });
  return NextResponse.json({ espaces: r.espaces, espace_actif: r.espace_actif });
}
