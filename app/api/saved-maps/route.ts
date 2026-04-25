import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

// GET  /api/saved-maps → liste des cartes sauvegardées (scopée user + org)
// POST /api/saved-maps → créer une sauvegarde (rattachée à user_id + organization_id)
// DELETE /api/saved-maps?id=xxx → supprimer (vérification ownership)

const SavedMapBodySchema = z.object({
  name: z.string().trim().min(1, 'name requis').max(200),
  zone_data: z.unknown().optional(),
  carreaux_config: z.unknown().optional(),
  isochrone_data: z.unknown().optional(),
  voronoi_data: z.unknown().optional(),
  messages: z.array(z.unknown()).optional(),
});

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const supabase = createAdminClient();
  let query = supabase
    .from('saved_maps')
    .select('id, name, ville, nb_pois, created_at, user_id, organization_id')
    .order('created_at', { ascending: false })
    .limit(50);

  if (profile.role !== 'super_admin') {
    const orFilter: string[] = [`user_id.eq.${profile.id}`];
    if (profile.organization_id) {
      orFilter.push(`organization_id.eq.${profile.organization_id}`);
    }
    query = query.or(orFilter.join(','));
  }

  const { data, error } = await query;

  if (error) {
    console.error('[saved-maps] GET error:', error.message);
    return NextResponse.json({ error: 'Erreur de chargement' }, { status: 500 });
  }

  return NextResponse.json({ maps: data ?? [] });
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const raw = await request.json().catch(() => null);
  const parsed = SavedMapBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Body invalide', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name, zone_data, carreaux_config, isochrone_data, voronoi_data, messages } = parsed.data;

  const zoneObj = (zone_data && typeof zone_data === 'object') ? zone_data as Record<string, unknown> : null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('saved_maps')
    .insert({
      name:            name.trim(),
      ville:           (zoneObj?.ville as string | null) ?? null,
      nb_pois:         (zoneObj?.nb_pois as number | null) ?? 0,
      zone_data:       zone_data ?? null,
      carreaux_config: carreaux_config ?? null,
      isochrone_data:  isochrone_data ?? null,
      voronoi_data:    voronoi_data ?? null,
      messages:        messages ?? [],
      updated_at:      new Date().toISOString(),
      user_id:         profile.id,
      organization_id: profile.organization_id,
    })
    .select('id, created_at')
    .single();

  if (error) {
    console.error('[saved-maps] POST error:', error.message);
    return NextResponse.json({ error: 'Erreur de sauvegarde' }, { status: 500 });
  }

  console.log(`[saved-maps] Carte sauvegardée: "${name}" (id=${data.id}, user=${profile.id})`);
  return NextResponse.json({ id: data.id, created_at: data.created_at });
}

export async function DELETE(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id requis' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: existing, error: fetchErr } = await supabase
    .from('saved_maps')
    .select('user_id, organization_id')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }

  if (profile.role !== 'super_admin') {
    const ownsByUser = existing.user_id && existing.user_id === profile.id;
    const ownsByOrg = existing.organization_id && existing.organization_id === profile.organization_id;
    if (!ownsByUser && !ownsByOrg) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { error } = await supabase
    .from('saved_maps')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[saved-maps] DELETE error:', error.message);
    return NextResponse.json({ error: 'Erreur de suppression' }, { status: 500 });
  }

  console.log(`[saved-maps] Carte supprimée: ${id} (user=${profile.id})`);
  return NextResponse.json({ ok: true });
}
