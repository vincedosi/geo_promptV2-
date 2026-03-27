import { NextResponse } from 'next/server';
import { type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ── POST — créer un nouveau POI ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createAdminClient();
  const body = await req.json();

  const { nom, categorie, sous_categorie, lat, lng, adresse, ville, departement, code_postal, source } = body;

  if (!categorie || lat == null || lng == null) {
    return NextResponse.json({ error: 'categorie, lat et lng sont requis' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('poi_france')
    .insert({
      nom: nom || null,
      categorie,
      sous_categorie: sous_categorie || null,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      adresse: adresse || null,
      ville: ville || null,
      departement: departement || null,
      code_postal: code_postal || null,
      source: source || 'manuel',
      date_import: new Date().toISOString(),
    })
    .select('id, nom, categorie, sous_categorie, lat, lng, adresse, ville, departement, code_postal, source')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, poi: data });
}

// ── PUT — modifier un POI existant ───────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const supabase = createAdminClient();
  const body = await req.json();

  const { id, nom, categorie, sous_categorie, lat, lng, adresse, ville, departement, code_postal, source } = body;

  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const { data, error } = await supabase
    .from('poi_france')
    .update({
      nom: nom || null,
      categorie,
      sous_categorie: sous_categorie || null,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
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
