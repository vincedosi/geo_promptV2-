/**
 * POST /api/user/switch-org
 * Body: { organization_id: UUID | null }
 * Switches the user's active organization.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient, getUserFromRequest } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';

export const dynamic = 'force-dynamic';

/**
 * `null` est une valeur METIER ici — « toutes les organisations », reserve au
 * super_admin — et doit rester distinct de l'absence de cle. Sans schema, un
 * corps vide passait : le super_admin recevait `{ success: true }` pour une
 * mise a jour qui n'ecrivait rien (supabase-js ignore `undefined`). Ce
 * faux succes devient un 400.
 */
const ChangerOrgSchema = z.object({
  organization_id: z.string().uuid().nullable(),
});

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const profile = await getUserFromRequest(authHeader);
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const corps = await lireCorps(request, ChangerOrgSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { organization_id } = corps.valeur;

  const supabase = createAdminClient();

  // Validate permission
  if (organization_id === null) {
    // "All orgs" → super_admin only
    if (profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Only super_admin can view all organizations' }, { status: 403 });
    }
  } else {
    // Check membership (super_admin can switch to any org)
    if (profile.role !== 'super_admin') {
      const { data: membership } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', profile.id)
        .eq('organization_id', organization_id)
        .single();

      if (!membership) {
        return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
      }
    }
  }

  // Update active org in profiles
  const { error } = await supabase
    .from('profiles')
    .update({ organization_id })
    .eq('id', profile.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, organization_id });
}
