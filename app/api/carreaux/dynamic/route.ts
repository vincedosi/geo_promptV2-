/**
 * GET /api/carreaux/dynamic
 * Sert les carreaux Filosofi multi-résolution selon le zoom et la bbox.
 * Appelle get_carreaux_by_zoom (RPC PostGIS — migration 015).
 *
 * Params : zoom, west, south, east, north, indicator, limit
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

const VALID_INDICATORS = new Set([
  // population
  'population_totale', 'population_inconnue',
  'ind_0_3', 'ind_4_5', 'ind_6_10', 'ind_11_17',
  'ind_18_24', 'ind_25_39', 'ind_40_54', 'ind_55_64', 'ind_65_79', 'ind_80p',
  // ménages
  'menages_total', 'menages_pauvres', 'menages_1_personne', 'menages_5_plus',
  'menages_proprietaires', 'familles_monoparentales',
  // logement
  'surface_moyenne', 'menages_maison', 'menages_collectif',
  // revenus
  'revenu_median',
  // logements (ancienneté)
  'logements_avant_1945', 'logements_1945_1970', 'logements_1970_1990',
  'logements_apres_1990', 'logements_sociaux', 'logements_inconnus',
]);

function cacheTTL(zoom: number): number {
  if (zoom <= 7)  return 3600;
  if (zoom <= 10) return 1800;
  if (zoom <= 13) return 900;
  return 300;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const zoom      = parseInt(sp.get('zoom')      ?? '10', 10);
  const west      = parseFloat(sp.get('west')    ?? '-5.5');
  const south     = parseFloat(sp.get('south')   ?? '41.0');
  const east      = parseFloat(sp.get('east')    ?? '10.0');
  const north     = parseFloat(sp.get('north')   ?? '51.5');
  const indicator = sp.get('indicator') ?? 'population_totale';
  const limit     = Math.min(parseInt(sp.get('limit') ?? '5000', 10), 10000);

  if ([zoom, west, south, east, north].some(isNaN)) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
  }
  if (!VALID_INDICATORS.has(indicator)) {
    return NextResponse.json({ error: 'Indicateur invalide' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc('get_carreaux_by_zoom', {
      zoom_level: zoom,
      bbox_west:  west,
      bbox_south: south,
      bbox_east:  east,
      bbox_north: north,
      indicateur: indicator,
      max_rows:   limit,
    });

    if (error) {
      console.error('[carreaux/dynamic] RPC error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as {
      id: string;
      geojson: string;
      value: number;
      population: number;
      menages: number;
    }[];

    const features = rows.map(r => ({
      type: 'Feature' as const,
      geometry: JSON.parse(r.geojson),
      properties: {
        id:         r.id,
        value:      r.value      ?? 0,
        population: r.population ?? 0,
        menages:    r.menages    ?? 0,
      },
    }));

    const ttl = cacheTTL(zoom);
    return NextResponse.json(
      { type: 'FeatureCollection', features },
      { headers: { 'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}` } }
    );
  } catch (err: unknown) {
    console.error('[carreaux/dynamic] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
