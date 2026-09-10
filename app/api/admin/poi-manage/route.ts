import { NextResponse } from 'next/server';
import { type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { triggerFilled } from '@/lib/supabase/tables';

export const dynamic = 'force-dynamic';

const poiCreateSchema = z.object({
  nom:             z.string().max(500).nullable().optional(),
  categorie:       z.string().min(1).max(100),
  sous_categorie:  z.string().max(200).nullable().optional(),
  lat:             z.coerce.number().min(-90).max(90),
  lng:             z.coerce.number().min(-180).max(180),
  adresse:         z.string().max(500).nullable().optional(),
  ville:           z.string().max(200).nullable().optional(),
  departement:     z.string().max(100).nullable().optional(),
  code_postal:     z.string().max(10).nullable().optional(),
  source:          z.string().max(100).nullable().optional(),
});

// ── POST — créer un nouveau POI ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();
  const rawBody = await req.json();
  const parsed = poiCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map(i => `${i.path}: ${i.message}`).join(', ') }, { status: 400 });
  }

  const { nom, categorie, sous_categorie, lat, lng, adresse, ville, departement, code_postal, source } = parsed.data;

  const { data, error } = await supabase
    .from('poi_france')
    .insert(triggerFilled<'poi_france', 'geom'>({
      nom: nom || null,
      categorie,
      sous_categorie: sous_categorie || null,
      lat,
      lng,
      adresse: adresse || null,
      ville: ville || null,
      departement: departement || null,
      code_postal: code_postal || null,
      source: source || 'manuel',
      date_import: new Date().toISOString(),
    }))
    .select('id, nom, categorie, sous_categorie, lat, lng, adresse, ville, departement, code_postal, source')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, poi: data });
}

// ── PUT — modifier un POI existant ───────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();
  const rawBody = await req.json();
  const parsed = poiCreateSchema.extend({ id: z.string().uuid() }).safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map(i => `${i.path}: ${i.message}`).join(', ') }, { status: 400 });
  }

  const { id, nom, categorie, sous_categorie, lat, lng, adresse, ville, departement, code_postal, source } = parsed.data;

  const { data, error } = await supabase
    .from('poi_france')
    .update({
      nom: nom || null,
      categorie,
      sous_categorie: sous_categorie || null,
      lat,
      lng,
      adresse: adresse || null,
      ville: ville || null,
      departement: departement || null,
      code_postal: code_postal || null,
      source: source || null,
    })
    .eq('id', id)
    .select('id, nom, categorie, sous_categorie, lat, lng, adresse, ville, departement, code_postal, source')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, poi: data });
}

// ── DELETE — supprimer 1 POI (id) ou tous d'une catégorie (cat) ──────────────
export async function DELETE(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();
  const id  = req.nextUrl.searchParams.get('id');
  const cat = req.nextUrl.searchParams.get('cat');

  if (id) {
    const { error } = await supabase.from('poi_france').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: 'single', id });
  }

  if (cat) {
    if (cat === 'arret_transport') return NextResponse.json({ error: 'Suppression des arrêts transport non autorisée ici' }, { status: 400 });
    const { error, count } = await supabase.from('poi_france').delete().eq('categorie', cat);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: 'bulk', cat, count });
  }

  return NextResponse.json({ error: 'id ou cat requis' }, { status: 400 });
}
