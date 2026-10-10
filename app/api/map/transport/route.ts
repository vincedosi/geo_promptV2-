import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/auth';
import type { ZoneData } from '@/types/spatial';
import { sourcesVisiblesDeLaRequete, filtrerParSourcesVisibles } from '@/lib/auth/perimetre-donnees';
import { lireJusqua } from '@/lib/supabase/lire-tout';

export const dynamic = 'force-dynamic';

/**
 * Nombre maximal d'arrêts rendus pour une vue. Borne I/O voulue : au-delà, la
 * route rend les BORNE_ARRETS premiers (par `id`) et `tronque: true`. Cinq
 * pages de 1 000 au plus, plus une ligne pour savoir s'il en reste.
 */
const BORNE_ARRETS = 5000;

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
  const sources = await sourcesVisiblesDeLaRequete(req);

  // Lecture PAGINÉE, bornée à BORNE_ARRETS. PostgREST plafonne toute requête de
  // table à 1 000 lignes (`db-max-rows`) : l'ancien `.limit(5000)` rendait
  // 1 000 arrêts sur les 1 626 de la vue de Marseille-Est, sans erreur
  // (mesuré le 2026-10-10). La borne, elle, est voulue — la France entière
  // porte 285 015 arrêts — mais elle est désormais DITE (`tronque`).
  // `order('id')` : sans ordre stable, deux pages pourraient se recouvrir.
  const construire = (de: number, a: number) => {
    let q = supabase
      .from('poi_france')
      .select('id, nom, lat, lng, sous_categorie')
      .eq('categorie', 'arret_transport')
      .gte('lat', south).lte('lat', north)
      .gte('lng', west).lte('lng', east)
      .order('id');

    if (types.length > 0) {
      q = q.in('sous_categorie', types);
    }

    // Les arrêts sont un référentiel système (sans source) : ils passent. Le
    // filtre écarte un éventuel import client de la même catégorie.
    return filtrerParSourcesVisibles(q, sources, { referentiels: true }).range(de, a);
  };

  let data: Awaited<ReturnType<typeof construire>>['data'];
  let tronque: boolean;
  try {
    ({ lignes: data, tronque } = await lireJusqua(construire, BORNE_ARRETS));
  } catch (err) {
    console.error('[api/map/transport] erreur:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Lecture des arrêts de transport impossible.' }, { status: 500 });
  }

  // Pas de type Row local : la forme vient du `.select()` et des types generes
  // (`nom` est nullable en base — l'ancien type local le declarait `string`).
  const pois = (data ?? []).map(r => ({
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

  logger.debug('api/map/transport', `${pois.length} arrêts${tronque ? ` (borne ${BORNE_ARRETS} atteinte)` : ''} dans bbox [${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}]`);
  return NextResponse.json({ ...zoneData, tronque });
}
