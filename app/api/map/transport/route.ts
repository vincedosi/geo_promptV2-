import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/auth';
import type { ZoneData } from '@/types/spatial';

export const dynamic = 'force-dynamic';

const SOUS_CATS_VALIDES = ['bus', 'tram', 'metro', 'train'] as const;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const west  = parseFloat(p.get('west')  ?? '-5.2');
  const south = parseFloat(p.get('south') ?? '41.0');
  const east  = parseFloat(p.get('east')  ?? '9.7');
  const north = parseFloat(p.get('north') ?? '51.5');
  const typesParam = p.get('types') ?? '';
  const types = typesParam
    ? typesParam.split(',').filter(t => (SOUS_CATS_VALIDES as readonly string[]).includes(t))
    : [];

  if ([west, south, east, north].some(isNaN)) {
    return NextResponse.json({ error: 'Paramètres bbox invalides' }, { status: 400 });
  }

  const supabase = createAdminClient();

  let q = supabase
    .from('poi_france')
    .select('id, nom, lat, lng, sous_categorie')
    .eq('categorie', 'arret_transport')
    .gte('lat', south).lte('lat', north)
    .gte('lng', west).lte('lng', east)
    .limit(5000);

  if (types.length > 0) {
    q = q.in('sous_categorie', types);
  }

  const { data, error } = await q;

  if (error) {
    console.error('[api/map/transport] erreur:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = { id: string; nom: string; lat: number; lng: number; sous_categorie: string | null };
  const pois = (data ?? []).map((r: Row) => ({
    id:         r.id,
    nom:        r.nom ?? 'Arrêt',
    lat:        r.lat,
    lng:        r.lng,
    categorie:  r.sous_categorie ?? 'arret_transport',
  }));

  const coordonnees = {
    lat: (south + north) / 2,
    lng: (west  + east)  / 2,
  };

  const zoneData: ZoneData = {
    ville:            'Zone visible',
    region:           null,
    departement:      null,
    categorie_poi:    'arret_transport',
    rayon_metres:     null,
    rayon_poi_metres: null,
    coordonnees,
    pois,
    nb_pois:          pois.length,
    categories:       { arret_transport: pois.length },
  };

  logger.debug('api/map/transport', `${pois.length} arrêts dans bbox [${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}]`);
  return NextResponse.json(zoneData);
}
