import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { lireCorps } from '@/lib/api/valider-corps';
import { RoleSchema } from '@/lib/auth/roles';
import { ajouterMembre } from '@/lib/espaces/appartenance';

export const dynamic = 'force-dynamic';

/**
 * Creation d'un compte (`SEC-001`).
 *
 * `role` etait auparavant accepte tel quel : un role inconnu passait la garde
 * `if (!email || !role)`, le compte Auth etait cree, puis la mise a jour du
 * profil echouait sur la contrainte `profiles_role_check` — echec journalise
 * mais NON remonte (`console.error` plus bas). L'appelant recevait un 201 pour
 * un compte au role par defaut. Le valider en amont evite ce succes partiel.
 * Depuis le 2026-10-09 l'echec d'ecriture du profil ou de l'appartenance est
 * remonte (500) et le compte Auth est retire.
 */
const CreerUtilisateurSchema = z.object({
  email: z.string().trim().min(1),
  full_name: z.string().trim().nullish(),
  role: RoleSchema,
  organization_id: z.string().uuid().nullish(),
});

/**
 * Origine publique de l'application, pour construire le `redirectTo` des liens
 * d'authentification. `NEXT_PUBLIC_APP_URL` fait autorite (c'est elle qui doit
 * figurer dans les Redirect URLs autorisees de Supabase) ; a defaut on retombe
 * sur l'origine de la requete, ce qui couvre le dev local.
 */
function appUrl(req: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, '');
}

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();

  let query = supabase.from('profiles').select('id, email, full_name, role, organization_id, created_at, organizations(name)').order('created_at', { ascending: false });

  // Admin can only see their org's users
  if (profile.role !== 'super_admin' && profile.organization_id) {
    query = query.eq('organization_id', profile.organization_id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users = (data ?? []).map((u: Record<string, unknown>) => ({
    ...u,
    organization_name: (u.organizations as Record<string, unknown> | null)?.name ?? null,
  }));

  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const corps = await lireCorps(request, CreerUtilisateurSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { email, full_name, role, organization_id } = corps.valeur;

  // Escalation protection
  if (profile.role !== 'super_admin') {
    if (role === 'super_admin') return NextResponse.json({ error: 'Vous ne pouvez pas créer de compte super_admin.' }, { status: 403 });
    if (organization_id && organization_id !== profile.organization_id) return NextResponse.json({ error: 'Vous ne pouvez pas créer de compte dans un autre espace.' }, { status: 403 });
  }

  if (role !== 'super_admin' && !organization_id) {
    return NextResponse.json({ error: "Un espace est obligatoire pour un compte qui n'est pas super_admin." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Check org exists and is active
  if (organization_id) {
    const { data: org } = await supabase.from('organizations').select('active').eq('id', organization_id).single();
    if (!org?.active) return NextResponse.json({ error: 'Espace introuvable ou désactivé.' }, { status: 400 });
  }

  // Creation du compte.
  //
  // `createUser` N'ENVOIE AUCUN EMAIL — c'est `inviteUserByEmail` qui le fait,
  // et il n'y a pas de systeme d'email dans ce projet. `email_confirm: true`
  // marque l'adresse comme deja verifiee (pas d'email de confirmation non
  // plus), et le compte nait SANS mot de passe : sans le lien genere ci-apres,
  // il serait inaccessible.
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: full_name || email.split('@')[0] },
  });

  if (authErr) {
    if (authErr.message?.includes('already')) return NextResponse.json({ error: 'Un compte existe déjà avec cet e-mail.' }, { status: 409 });
    return NextResponse.json({ error: authErr.message }, { status: 500 });
  }

  // Rôle + nom, puis appartenance. L'appartenance s'écrit AVANT l'espace actif
  // (sql/236 refuse un actif dont l'utilisateur n'est pas membre) : c'est
  // ajouterMembre qui pose les deux, dans cet ordre.
  const nouvelId = authUser.user.id;
  const { error: profErr } = await supabase.from('profiles')
    .update({ role, full_name: full_name || null }).eq('id', nouvelId);
  const ajout = !profErr && organization_id
    ? await ajouterMembre(supabase, organization_id, nouvelId)
    : { ok: true as const };
  if (profErr || !ajout.ok) {
    // Pas de compte à moitié créé : on le retire, et on dit pourquoi.
    const { error: errSuppr } = await supabase.auth.admin.deleteUser(nouvelId);
    if (errSuppr) console.error('[admin/users POST] compte orphelin', nouvelId, errSuppr.message);
    const message = profErr ? profErr.message : (ajout as { message: string }).message;
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Lien de premiere connexion, a transmettre a la main par l'admin.
  // `generateLink` ne fait que GENERER : il n'envoie rien, il retourne l'URL.
  // Non bloquant — le compte existe meme si la generation echoue, et le lien
  // se regenere depuis la page de l'organisation.
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${appUrl(request)}/reset-password` },
  });
  if (linkErr) console.error('[admin/users POST] generateLink:', linkErr.message);

  return NextResponse.json({
    id: authUser.user.id,
    email,
    setup_link: linkData?.properties?.action_link ?? null,
  }, { status: 201 });
}
