/**
 * POST /api/admin/users/[id]/lien-mot-de-passe
 *
 * Lien de mot de passe d'un compte, désigné par son IDENTIFIANT — pas par son
 * email ni par un espace. La fiche d'un compte (page Accès) l'appelle pour
 * TOUT compte, y compris un super_admin rattaché à aucun espace, que la route
 * de l'onglet Membres (`organizations/[id]/members/reset-password`) ne
 * pouvait pas atteindre.
 *
 * Aucun corps. Réponse : `{ lien }`, un secret d'usage unique, jamais journalisé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { genererLienMotDePasse, origineApplication } from '@/lib/espaces/lien-mot-de-passe';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();
const INTROUVABLE = 'Compte introuvable.';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  // Un identifiant qui n'est pas un UUID ne désigne aucun compte : 404, sans
  // laisser Postgres répondre une erreur de syntaxe en 500.
  const id = IdSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: INTROUVABLE }, { status: 404 });

  const sb = createAdminClient();
  const { data, error } = await sb.from('profiles').select('email').eq('id', id.data).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.email) return NextResponse.json({ error: INTROUVABLE }, { status: 404 });

  const { lien, erreur } = await genererLienMotDePasse(sb, data.email, origineApplication(request.url));
  if (erreur) return NextResponse.json({ error: erreur }, { status: 500 });
  if (!lien) return NextResponse.json({ error: 'Lien non généré.' }, { status: 500 });
  return NextResponse.json({ lien });
}
