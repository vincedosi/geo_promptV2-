import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// GET  /api/saved-maps → liste des cartes sauvegardées
// POST /api/saved-maps → créer une sauvegarde
// DELETE /api/saved-maps?id=xxx → supprimer

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('saved_maps')
    .select('id, name, ville, nb_pois, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[saved-maps] GET error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ maps: data ?? [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, zone_data, carreaux_config, isochrone_data, messages } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name requis' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('saved_maps')
    .insert({
      name:            name.trim(),
      ville:           zone_data?.ville ?? null,
      nb_pois:         zone_data?.nb_pois ?? 0,
      zone_data:       zone_data ?? null,
      carreaux_config: carreaux_config ?? null,
      isochrone_data:  isochrone_data ?? null,
      messages:        messages ?? [],
      updated_at:      new Date().toISOString(),
    })
    .select('id, created_at')
    .single();

  if (error) {
    console.error('[saved-maps] POST error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`[saved-maps] Carte sauvegardée: "${name}" (id=${data.id})`);
  return NextResponse.json({ id: data.id, created_at: data.created_at });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id requis' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('saved_maps')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[saved-maps] DELETE error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`[saved-maps] Carte supprimée: ${id}`);
  return NextResponse.json({ ok: true });
}

// GET /api/saved-maps/[id] — charge une carte complète (avec zone_data + isochrone_data)
// Géré séparément dans /api/saved-maps/[id]/route.ts si besoin
// Pour l'instant on récupère tout dans le GET liste
