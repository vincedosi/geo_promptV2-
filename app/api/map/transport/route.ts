import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/auth';
import type { ZoneData } from '@/types/spatial';
import { sourcesVisiblesDeLaRequete } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';

/**
 * Nombre maximal d'arrêts rendus pour une vue. Borne I/O voulue (285 015
 * arrêts en France) : au-delà, la RPC rend les BORNE_ARRETS premiers par `id`
 * et `tronque: true` — elle lit BORNE_ARRETS + 1 lignes pour le savoir.
 * Retour `jsonb` : la relever ne réveille aucune troncature PostgREST.
 */
const BORNE_ARRETS = 5000;

/** Ce que rend `lire_arrets_transport_bbox` (sql/241). */
interface ReponseArrets {
  arrets: { id: string; nom: string | null; lat: number; lng: number; sous_categorie: string | null }[];
  tronque: boolean;
}

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

  // UN passage en base (RPC `lire_arrets_transport_bbox`, sql/241, `jsonb`).
  // Une requête de table plafonnait à 1 000 lignes (`db-max-rows`) : 1 000
  // arrêts sur les 1 626 de Marseille-Est. La lecture paginée qui avait suivi
  // refaisait, à CHAQUE page, le parcours de l'index de catégorie (285 015
  // arrêts) : ≈ 177 000 buffers sur la vue de Paris, contre ≈ 6 800 ici.
  //
  // Périmètre : les arrêts sont un référentiel système (sans source), ils
  // passent ; `p_sources` écarte un éventuel import client de la même
  // catégorie (`null` = super_admin, tout). Les identifiants viennent de la
  // base (colonne uuid).
  const { data, error } = await supabase.rpc('lire_arrets_transport_bbox', {
    p_west: west,
    p_south: south,
    p_east: east,
    p_north: north,
    p_types: types.length > 0 ? types : undefined,
    p_sources: sources ?? undefined,
    p_limite: BORNE_ARRETS,
  });

  if (error) {
    console.error('[api/map/transport] erreur RPC lire_arrets_transport_bbox:', error.message);
    return NextResponse.json({ error: 'Lecture des arrêts de transport impossible.' }, { status: 500 });
  }

  const lu = (data ?? { arrets: [], tronque: false }) as unknown as ReponseArrets;
  const tronque = lu.tronque === true;

  const pois = (lu.arrets ?? []).map(r => ({
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
