/**
 * POST /api/admin/organizations/[id]/members/reset-password
 * Génère un lien de reset password pour un membre
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { genererLienMotDePasse, origineApplication } from '@/lib/espaces/lien-mot-de-passe';

export const dynamic = 'force-dynamic';

const LienResetSchema = z.object({
  email: z.string().trim().min(1, 'Email requis'),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const corps = await lireCorps(request, LienResetSchema);
  if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
  const { email } = corps.valeur;

  // `redirectTo` (vers /reset-password) est construit par genererLienMotDePasse :
  // sans lui, le lien retombe sur le Site URL, ou aucune page ne sait definir
  // un mot de passe.
  const { lien, erreur } = await genererLienMotDePasse(sb, email, origineApplication(request.url));
  if (erreur) return NextResponse.json({ success: false, error: erreur }, { status: 500 });

  return NextResponse.json({ success: true, link: lien });
}
