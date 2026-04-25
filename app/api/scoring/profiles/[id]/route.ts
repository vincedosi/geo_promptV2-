import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const PutBodySchema = z.object({
  nom: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  profil: z.record(z.unknown()).optional(),
  is_template: z.boolean().optional(),
});

function canRead(
  profile: { id: string; role: string; organization_id: string | null },
  row: { organization_id: string | null; is_template: boolean }
): boolean {
  if (profile.role === 'super_admin') return true;
  if (row.is_template) return true;
  return !!row.organization_id && row.organization_id === profile.organization_id;
}

function canWrite(
  profile: { id: string; role: string; organization_id: string | null },
  row: { organization_id: string | null; is_template: boolean }
): boolean {
  if (profile.role === 'super_admin') return true;
  if (row.is_template) return false;
  return !!row.organization_id && row.organization_id === profile.organization_id;
}

// GET /api/scoring/profiles/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const profile = await requireAuth(req);
  if (!profile) return authUnauthorized();

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('scoring_profiles')
      .select('*')
      .eq('id', params.id)
      .single();

    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canRead(profile, data)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    return NextResponse.json({ profile: data });
  } catch (err) {
    console.error('[scoring/profiles/[id]] GET error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// PUT /api/scoring/profiles/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const profile = await requireAuth(req);
  if (!profile) return authUnauthorized();

  try {
    const raw = await req.json().catch(() => null);
    const parsed = PutBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body invalide', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const supabase = createAdminClient();

    const { data: existing, error: fetchErr } = await supabase
      .from('scoring_profiles')
      .select('organization_id, is_template')
      .eq('id', params.id)
      .single();

    if (fetchErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canWrite(profile, existing)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data, error } = await supabase
      .from('scoring_profiles')
      .update({
        ...(body.nom         !== undefined && { nom: body.nom }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.profil      !== undefined && { profil: body.profil }),
        ...(body.is_template !== undefined && profile.role === 'super_admin' && { is_template: body.is_template }),
      })
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      console.error('[scoring/profiles/[id]] PUT error:', error.message);
      return NextResponse.json({ error: 'Erreur de modification' }, { status: 500 });
    }
    return NextResponse.json({ profile: data });
  } catch (err) {
    console.error('[scoring/profiles/[id]] PUT exception:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// DELETE /api/scoring/profiles/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const profile = await requireAuth(req);
  if (!profile) return authUnauthorized();

  try {
    const supabase = createAdminClient();

    const { data: existing, error: fetchErr } = await supabase
      .from('scoring_profiles')
      .select('organization_id, is_template')
      .eq('id', params.id)
      .single();

    if (fetchErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (existing.is_template && profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Les templates ne peuvent pas être supprimés' }, { status: 403 });
    }
    if (!canWrite(profile, existing)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabase
      .from('scoring_profiles')
      .delete()
      .eq('id', params.id);

    if (error) {
      console.error('[scoring/profiles/[id]] DELETE error:', error.message);
      return NextResponse.json({ error: 'Erreur de suppression' }, { status: 500 });
    }
    return NextResponse.json({ deleted: params.id });
  } catch (err) {
    console.error('[scoring/profiles/[id]] DELETE exception:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
