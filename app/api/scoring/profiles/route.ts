import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';

// GET /api/scoring/profiles — liste des profils filtrée par org
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionOrg(req);
    const supabase = createAdminClient();

    let query = supabase
      .from('scoring_profiles')
      .select('id, nom, description, is_template, organization_id, profil, created_at, updated_at')
      .order('is_template', { ascending: false })
      .order('created_at', { ascending: true });

    if (session?.role === 'super_admin') {
      // Super admin voit tout — pas de filtre
    } else if (session?.orgId) {
      // Admin / client : templates + profils de son org
      query = query.or(`is_template.eq.true,organization_id.eq.${session.orgId}`);
    } else {
      // Pas de session (dev bypass) : templates uniquement
      query = query.eq('is_template', true);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ profiles: data ?? [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/scoring/profiles — créer un profil
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionOrg(req);
    const body = await req.json() as {
      nom: string;
      description?: string;
      organization_id?: string;
      profil: Record<string, unknown>;
      is_template?: boolean;
    };

    if (!body.nom || !body.profil) {
      return NextResponse.json({ error: 'nom et profil requis' }, { status: 400 });
    }

    // org_id : depuis la session si non super_admin (le body ne peut pas l'imposer)
    const orgId = (session?.role === 'super_admin')
      ? (body.organization_id ?? null)
      : (session?.orgId ?? null);

    // Seul super_admin peut créer des templates
    const isTemplate = (session?.role === 'super_admin') ? (body.is_template ?? false) : false;

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('scoring_profiles')
      .insert({
        nom:             body.nom,
        description:     body.description ?? null,
        organization_id: orgId,
        profil:          body.profil,
        is_template:     isTemplate,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
