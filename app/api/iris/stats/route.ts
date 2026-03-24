import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_IRIS_COLUMNS = new Set([
  'population',
  'pop_0_14', 'pop_15_29', 'pop_30_44', 'pop_45_59', 'pop_60_74', 'pop_75_plus',
  'nb_csp_cadre', 'nb_csp_employe', 'nb_csp_ouvrier',
  // Colonnes présentes dans le schéma mais non encore renseignées (réservées pour import futur)
  // 'rev_median', 'taux_diplome_sup', 'nb_diplome_sup', 'taux_chomage', 'taux_proprio',
]);

// GET /api/iris/stats?colonne=pop_15_29&bbox=...&level=iris|dept
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const colonne = searchParams.get('colonne') ?? '';
  const bbox    = searchParams.get('bbox');
  const level   = searchParams.get('level') ?? 'iris'; // 'iris' ou 'dept'

  if (!ALLOWED_IRIS_COLUMNS.has(colonne)) {
    return NextResponse.json({ error: 'Colonne invalide' }, { status: 400 });
  }

  let west = -10.0, south = 41.0, east = 10.0, north = 52.0;
  if (bbox) {
    const parts = bbox.split(',').map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      [west, south, east, north] = parts;
    }
  }

  const supabase = createAdminClient();

  if (level === 'dept') {
    // Stats sur les moyennes par département via RPC SQL (pas de limite de lignes)
    const { data, error } = await supabase.rpc('get_iris_dept_stats', {
      p_colonne: colonne,
      p_west: west, p_south: south, p_east: east, p_north: north,
    });
    if (error) {
      console.error('[iris/stats] dept RPC error:', error.message);
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
    }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  }

  const { data, error } = await supabase.rpc('get_iris_stats_by_bbox', {
    p_colonne: colonne,
    p_west: west, p_south: south, p_east: east, p_north: north,
  });

  if (error) {
    console.error('[iris/stats] RPC error:', error.message);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
