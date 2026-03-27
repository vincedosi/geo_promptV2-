import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

import { IRIS_DB_COLUMN_NAMES } from '@/lib/iris-crawler/db-columns';

// Whitelist dérivée de la source de vérité unique : lib/iris-crawler/db-columns.ts
const ALLOWED_IRIS_COLUMNS = IRIS_DB_COLUMN_NAMES;

// GET /api/iris/geojson?bbox=west,south,east,north&colonne=pop_15_29&simplify=0.0005
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const bbox     = searchParams.get('bbox');
  const colonne  = searchParams.get('colonne') ?? '';
  const simplify = parseFloat(searchParams.get('simplify') ?? '0.0005');
  const maxRows  = parseInt(searchParams.get('max_rows') ?? '5000', 10);

  // ── Validation bbox ──────────────────────────────────────────────────────
  if (!bbox) {
    return NextResponse.json({ error: 'bbox requis (west,south,east,north)' }, { status: 400 });
  }
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return NextResponse.json({ error: 'bbox invalide' }, { status: 400 });
  }
  const [west, south, east, north] = parts;

  // ── Validation colonne (whitelist anti-injection) ────────────────────────
  const safeColonne = ALLOWED_IRIS_COLUMNS.has(colonne) ? colonne : null;

  // ── Validation simplify (cap à 0.1 pour vue nationale) ───────────────────
  const safeSimplify = isNaN(simplify) ? 0.0005 : Math.max(0, Math.min(simplify, 0.1));

  // ── Validation max_rows (1000–25000) ─────────────────────────────────────
  const safeMaxRows = isNaN(maxRows) ? 5000 : Math.max(1000, Math.min(maxRows, 25000));

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_iris_geojson_by_bbox', {
    p_west:     west,
    p_south:    south,
    p_east:     east,
    p_north:    north,
    p_colonne:  safeColonne,
    p_simplify: safeSimplify,
    p_max_rows: safeMaxRows,
  });

  if (error) {
    console.error('[iris/geojson] RPC error:', error.message);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }

  const geojson = data as { type: string; features: unknown[] } | null;
  const featureCount = geojson?.features?.length ?? 0;
  const truncated = featureCount >= safeMaxRows;

  return NextResponse.json(
    { ...(geojson ?? { type: 'FeatureCollection', features: [] }), truncated },
    {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'X-IRIS-Count': String(featureCount),
        'X-IRIS-Truncated': String(truncated),
      },
    }
  );
}
