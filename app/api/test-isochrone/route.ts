/**
 * GET /api/test-isochrone?region=Bretagne&category=cirfa&minutes=10&mode=drive
 *
 * Test de validation ORS : retourne les polygones BRUTS de N minutes
 * pour une catégorie/région donnée, sans aucun traitement PostGIS.
 * Prouve que l'API ORS retourne des géométries routières réelles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';
import { ORS_PROFILES }              from '@/lib/isochrones/fetcher';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const region   = searchParams.get('region')   ?? 'Bretagne';
  const category = searchParams.get('category') ?? 'cirfa';
  const minutes  = Math.max(1, Math.min(120, Number(searchParams.get('minutes') ?? '10')));
  const mode     = searchParams.get('mode')     ?? 'drive';

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ORS_API_KEY non configurée dans les variables d\'environnement.' },
      { status: 500 }
    );
  }

  const supabase = createAdminClient();

  // ── 1. Charger les POIs ──────────────────────────────────────────────────
  const { data: pois, error: poiErr } = await supabase
    .from('poi_france')
    .select('id, nom, lat, lng')
    .ilike('categorie', category)
    .ilike('region',    `%${region}%`)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .limit(50);

  if (poiErr) {
    return NextResponse.json({ error: poiErr.message }, { status: 500 });
  }

  if (!pois || pois.length === 0) {
    return NextResponse.json(
      { error: `Aucun POI trouvé pour categorie="${category}" region="${region}"` },
      { status: 404 }
    );
  }

  console.log(`[test-iso] ${pois.length} POIs trouvés (${category} / ${region})`);

  // ── 2. Appel ORS direct — polygones bruts, pas de cache ─────────────────
  const profile    = ORS_PROFILES[mode] ?? 'driving-car';
  const rangeSec   = minutes * 60;
  const locations  = pois.map(p => [Number(p.lng), Number(p.lat)] as [number, number]);

  // ORS accepte max 5 locations par appel → on prend les 5 premiers pour le test
  const testLocs = locations.slice(0, 5);
  const testPois = pois.slice(0, 5);

  console.log(`[test-iso] Appel ORS : ${testLocs.length} locations, ${minutes}min, mode=${mode}`);

  let orsData: any = null;
  let orsError: string | null = null;

  try {
    const res = await fetch(
      `https://api.openrouteservice.org/v2/isochrones/${profile}`,
      {
        method:  'POST',
        headers: {
          Authorization:  apiKey,
          'Content-Type': 'application/json',
          Accept:         'application/json, application/geo+json',
        },
        body: JSON.stringify({
          locations: testLocs,
          range:      [rangeSec],
          range_type: 'time',
        }),
      }
    );

    if (!res.ok) {
      orsError = `ORS HTTP ${res.status}: ${await res.text()}`;
    } else {
      orsData = await res.json();
    }
  } catch (e: any) {
    orsError = `Fetch error: ${e.message}`;
  }

  if (orsError || !orsData) {
    return NextResponse.json(
      { error: orsError ?? 'ORS n\'a rien retourné', pois_found: pois.length },
      { status: 502 }
    );
  }

  // ── 3. Retourner les polygones bruts avec info debug ─────────────────────
  const features = orsData.features ?? [];

  // Annoter chaque feature avec le nom du CIRFA (via group_index)
  const annotated = features.map((f: any) => ({
    ...f,
    properties: {
      ...f.properties,
      cirfa_nom:  testPois[f.properties?.group_index ?? 0]?.nom ?? '?',
      cirfa_id:   String(testPois[f.properties?.group_index ?? 0]?.id ?? '?'),
      minutes_req: minutes,
      mode,
    },
  }));

  return NextResponse.json({
    type:     'FeatureCollection',
    features: annotated,
    _debug: {
      poi_count:    pois.length,
      tested_count: testLocs.length,
      region,
      category,
      minutes,
      mode,
      ors_feature_count: features.length,
      message: features.length > 0
        ? `✅ ORS OK — ${features.length} polygone(s) routier(s) réel(s) retourné(s)`
        : '⚠️ ORS a répondu mais sans features (vérifier les coordonnées)',
    },
  });
}
