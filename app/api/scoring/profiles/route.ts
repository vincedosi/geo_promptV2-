import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// GET /api/scoring/profiles — liste des profils (templates + org)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('organization_id');

    const supabase = createAdminClient();

    let query = supabase
      .from('scoring_profiles')
      .select('id, nom, description, is_template, organization_id, profil, created_at, updated_at')
      .order('is_template', { ascending: false })
      .order('created_at', { ascending: true });

    // Retourner templates + profils de l'org si orgId fourni
    if (orgId) {
      query = query.or(`is_template.eq.true,organization_id.eq.${orgId}`);
    } else {
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

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('scoring_profiles')
      .insert({
        nom:             body.nom,
        description:     body.description ?? null,
        organization_id: body.organization_id ?? null,
        profil:          body.profil,
        is_template:     body.is_template ?? false,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
