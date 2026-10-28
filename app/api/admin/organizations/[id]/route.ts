/**
 * GET    /api/admin/organizations/[id] — Détail d'une organisation
 * PATCH  /api/admin/organizations/[id] — Mise à jour config workspace (et groupe d'espaces, sql/289)
 * DELETE /api/admin/organizations/[id] — Suppression organisation (super_admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { ID_ORGANISATION_INTERNE, SLUG_ORGANISATION_INTERNE } from '@/lib/espaces/nom-espace';
import { FILTRE_SOURCE_NON_SUPPRIMEE } from '@/lib/auth/getOrgSourceIds';

export const dynamic = 'force-dynamic';

/**
 * Les six seules cles que la route recopie vers la base. Toutes optionnelles :
 * `undefined` signifie « ne pas toucher », et les `if (… !== undefined)` plus
 * bas en dependent.
 *
 * `config` est une colonne `jsonb` libre : on n'en valide pas la forme, sous
 * peine de refuser des configurations qui fonctionnent aujourd'hui.
 */
const ModifierOrganisationSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  slug: z.string().optional(),
  config: z.unknown().optional(),
  active: z.boolean().optional(),
  // Groupe d'espaces (sql/289, A-9) : un nom rogné de 1 à 60 caractères, ou `null` pour retirer l'espace de son
  // groupe. Range la colonne d'Accès ; ne porte aucun droit. Le CHECK de la colonne refait la même borne.
  groupe_espace: z.string().trim().min(1, 'Le groupe ne peut pas être vide.')
    .max(60, 'Le groupe fait 60 caractères au plus.').nullable().optional(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id } = await params;

  const [orgRes, membersRes, sourcesRes, allSourcesRes] = await Promise.all([
    sb.from('organizations').select('*').eq('id', id).single(),
    sb.from('profiles').select('id, email, full_name, role, created_at').eq('organization_id', id),
    sb.from('data_sources').select('id, name, type, row_count, import_date, status, shared_with').eq('organization_id', id).or(FILTRE_SOURCE_NON_SUPPRIMEE),
    sb.from('data_sources')
      .select('id, name, type, row_count, import_date, organization_id, shared_with, organizations(name, slug)')
      .neq('organization_id', id)
      .or(FILTRE_SOURCE_NON_SUPPRIMEE)
      .order('import_date', { ascending: false }),
  ]);

  if (orgRes.error || !orgRes.data) {
    return NextResponse.json({ success: false, error: 'Organisation introuvable' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    organization: orgRes.data,
    members: membersRes.data ?? [],
    sources: sourcesRes.data ?? [],
    available_sources: allSourcesRes.data ?? [],
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id } = await params;
  const corps = await lireCorps(request, ModifierOrganisationSchema);
  if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
  const body = corps.valeur;

  // Non-super_admin can only edit their own org, and cannot touch slug/config/active
  if (profile.role !== 'super_admin') {
    if (id !== profile.organization_id) {
      return NextResponse.json({ error: 'Vous ne pouvez pas modifier un autre espace.' }, { status: 403 });
    }
    delete body.slug;
    delete body.config;
    delete body.active;
    // Les groupes rangent la page Accès, réservée au super_admin.
    delete body.groupe_espace;
  }

  // Le slug de l'espace interne est lu par des scripts et la démo : il ne
  // change pas. Renvoyer le même (formulaire entier) reste accepté.
  if (id.toLowerCase() === ID_ORGANISATION_INTERNE && body.slug !== undefined && body.slug !== SLUG_ORGANISATION_INTERNE) {
    return NextResponse.json({ success: false, error: "Le slug de l'espace interne ne se modifie pas." }, { status: 409 });
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  // slug, config, active: super_admin only (already stripped above for non-super_admin)
  if (body.slug !== undefined) updates.slug = body.slug;
  if (body.config !== undefined) updates.config = body.config;
  if (body.active !== undefined) updates.active = body.active;
  if (body.groupe_espace !== undefined) updates.groupe_espace = body.groupe_espace;

  const { data, error } = await sb
    .from('organizations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, organization: data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  // Only super_admin can delete organizations
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Seul un super_admin peut supprimer un espace.' }, { status: 403 });
  }

  const sb = createAdminClient();
  const { id } = await params;

  const { error: checkError, data: org } = await sb
    .from('organizations')
    .select('id, slug')
    .eq('id', id)
    .single();

  if (checkError || !org) {
    return NextResponse.json({ success: false, error: 'Organisation introuvable' }, { status: 404 });
  }
  // L'espace interne porte les données du socle : la page masque le bouton,
  // mais un appel direct ne doit pas pouvoir le supprimer non plus. Gardé par
  // l'IDENTIFIANT : le slug se modifie par PATCH.
  if (org.id === ID_ORGANISATION_INTERNE) {
    return NextResponse.json({ success: false, error: "L'espace interne porte les données du socle : il ne se supprime pas." }, { status: 409 });
  }

  const { error } = await sb.from('organizations').delete().eq('id', id);
  // Un espace qui possède un indicateur (sql/288) : la suppression cascade sur sa
  // source, que la FK `restrict` du registre bloque. Le résultat est le bon (rien
  // ne redevient public, rien n'est supprimé) ; on le dit en français plutôt que
  // de rendre le message brut de PostgreSQL en 500.
  if (error && error.code === '23503' && /cible_indicator_registry/.test(error.message ?? '')) {
    return NextResponse.json({
      success: false,
      refus: 'indicateur_possede',
      error: 'Cet espace possède un indicateur : rendez-le au socle ou transférez-le avant de supprimer l\'espace.',
    }, { status: 409 });
  }
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
