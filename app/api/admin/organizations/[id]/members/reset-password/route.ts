/**
 * POST /api/admin/organizations/[id]/members/reset-password
 * Génère un lien de reset password pour un membre
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';

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

  // `redirectTo` est indispensable : sans lui, le lien retombe sur le Site URL
  // par defaut du projet Supabase, ou aucune page ne sait definir un mot de
  // passe. Il doit figurer dans les Redirect URLs autorisees du projet.
  const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  const { data, error } = await sb.auth.admin.generateLink({
    type: 'recovery',
    email: email.toLowerCase(),
    options: { redirectTo: `${base}/reset-password` },
  });

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const linkData = data as { properties?: { action_link?: string } } | null;
  return NextResponse.json({ success: true, link: linkData?.properties?.action_link ?? null });
}
