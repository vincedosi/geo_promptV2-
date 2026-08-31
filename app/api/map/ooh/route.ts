import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import type { ZoneData } from '@/types/spatial';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { regies } = body as { regies?: string[] };

    const supabase = createAdminClient();

    let query = supabase
      .from('panneaux_affichage')
      .select('id, regie, type_panneau, adresse, ville, lat, lng, nb_faces, metadata')
      .eq('actif', true)
      .order('regie');

    if (regies && regies.length > 0) {
      query = query.in('regie', regies);
    }

    const { data, error } = await query.limit(5000);

    if (error) {
      console.error('[api/map/ooh] erreur:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data?.length) {
      return NextResponse.json({ error: 'Aucun panneau trouvé' }, { status: 404 });
    }

    interface OohRow {
      id: string;
      regie?: string | null;
      type_panneau?: string | null;
      adresse?: string | null;
      ville?: string | null;
      lat: number | string;
      lng: number | string;
      nb_faces?: number | null;
      metadata?: Record<string, unknown> | null;
    }
    const pois = (data as OohRow[]).map((p) => ({
      id: p.id,
      nom: p.regie ? `${p.regie}${p.type_panneau ? ` — ${p.type_panneau}` : ''}` : 'Panneau OOH',
      lat: Number(p.lat),
      lng: Number(p.lng),
      categorie: 'panneaux',
      sous_categorie: p.type_panneau ?? undefined,
      adresse: p.adresse ?? undefined,
      ville: p.ville ?? undefined,
    }));

    // Centroïde
    const coordonnees = {
      lat: pois.reduce((s, p) => s + p.lat, 0) / pois.length,
      lng: pois.reduce((s, p) => s + p.lng, 0) / pois.length,
    };

    const categories: Record<string, number> = { panneaux: pois.length };

    const label = regies?.length
      ? `${regies.length} régie${regies.length > 1 ? 's' : ''} OOH`
      : 'Tous les panneaux OOH';

    const zoneData: ZoneData = {
      ville: label,
      region: null,
      departement: null,
      categorie_poi: 'panneaux',
      rayon_metres: null,
      rayon_poi_metres: null,
      coordonnees,
      pois,
      nb_pois: pois.length,
      categories,
    };

    console.log(`[api/map/ooh] ${pois.length} panneaux — régies: ${regies?.join(', ') ?? 'toutes'}`);
    return NextResponse.json(zoneData);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/map/ooh] ERREUR:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
