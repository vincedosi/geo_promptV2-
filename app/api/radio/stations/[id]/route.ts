/**
 * GET /api/radio/stations/[id] — Fiche détaillée d'une radio
 * PUT /api/radio/stations/[id] — Mise à jour (super-admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  const supabase = createAdminClient();

  const { data: radio, error } = await supabase
    .from('radios')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !radio) {
    return NextResponse.json({ error: 'Radio non trouvée' }, { status: 404 });
  }

  // Get emitters for this radio via junction table
  const { data: junctionRows } = await supabase
    .from('emetteur_radio_stations')
    .select('emetteur_id')
    .eq('radio_id', id)
    .limit(500);

  const emetteurIds = (junctionRows ?? []).map((r: { emetteur_id: string }) => r.emetteur_id);

  let emetteurs: Record<string, unknown>[] = [];
  if (emetteurIds.length > 0) {
    // Fetch in chunks of 100 (Supabase .in() limit)
    for (let i = 0; i < emetteurIds.length; i += 100) {
      const chunk = emetteurIds.slice(i, i + 100);
      const { data } = await supabase
        .from('emetteurs_radio')
        .select('id, sta_nm_anfr, systeme, frequence_mhz, puissance_w, hauteur_m, commune, departement, rayon_couverture_m')
        .in('id', chunk)
        .order('departement', { ascending: true });
      if (data) emetteurs.push(...data);
    }
  }

  return NextResponse.json({
    radio,
    emetteurs,
    nb_emetteurs: emetteurs.length,
    nb_emetteurs_fm: emetteurs.filter((e) => e.systeme === 'FM').length,
    nb_emetteurs_dab: emetteurs.filter((e) => e.systeme === 'DAB+').length,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const { id } = params;
  const body = await req.json();
  const supabase = createAdminClient();

  // Whitelist allowed update fields
  const updates: Record<string, unknown> = {};
  for (const key of ['nom', 'categorie_arcom', 'portee', 'genre', 'groupe_media', 'logo_url', 'site_web', 'audience_data', 'tarifs_data', 'metadata']) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.audience_data) updates.audience_updated_at = new Date().toISOString();
  if (body.tarifs_data) updates.tarifs_updated_at = new Date().toISOString();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à modifier' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('radios')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, radio: data });
}
