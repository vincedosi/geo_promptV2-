import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// GET /api/scoring/profiles/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('scoring_profiles')
      .select('*')
      .eq('id', params.id)
      .single();

    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ profile: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PUT /api/scoring/profiles/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json() as {
      nom?: string;
      description?: string;
      profil?: Record<string, unknown>;
      is_template?: boolean;
    };

    const supabase = createAdminClient();

    // Empêcher la modification des templates via cette route (utiliser is_template=false uniquement)
    const { data: existing } = await supabase
      .from('scoring_profiles')
      .select('is_template')
      .eq('id', params.id)
      .single();

    if (existing?.is_template && body.profil) {
      // Autoriser la modification des templates en admin (pas de restriction ici — la protection
      // sera côté UI)
    }

    const { data, error } = await supabase
      .from('scoring_profiles')
      .update({
        ...(body.nom         !== undefined && { nom: body.nom }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.profil      !== undefined && { profil: body.profil }),
        ...(body.is_template !== undefined && { is_template: body.is_template }),
      })
      .eq('id', params.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE /api/scoring/profiles/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createAdminClient();

    // Refuser la suppression des templates
    const { data: existing } = await supabase
      .from('scoring_profiles')
      .select('is_template')
      .eq('id', params.id)
      .single();

    if (existing?.is_template) {
      return NextResponse.json({ error: 'Les templates ne peuvent pas être supprimés' }, { status: 403 });
    }

    const { error } = await supabase
      .from('scoring_profiles')
      .delete()
      .eq('id', params.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: params.id });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
