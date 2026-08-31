import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

import { IRIS_DB_COLUMN_NAMES } from '@/lib/iris-crawler/db-columns';

// Whitelist dérivée de la source de vérité unique : lib/iris-crawler/db-columns.ts
const ALLOWED_IRIS_COLUMNS = IRIS_DB_COLUMN_NAMES;

// GET /api/iris/stats?colonne=pop_15_29&bbox=...&level=iris|dept
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const colonne           = searchParams.get('colonne') ?? '';
  const bbox              = searchParams.get('bbox');
  const level             = searchParams.get('level') ?? 'iris'; // 'iris' ou 'dept'
  const include_communal  = searchParams.get('include_communal') === 'true';
  const true_iris_only    = !include_communal;

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
      p_true_iris_only: true_iris_only,
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
    p_true_iris_only: true_iris_only,
  });

  if (error) {
    console.error('[iris/stats] RPC error:', error.message);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
