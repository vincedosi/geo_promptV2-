import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ── Whitelist des colonnes IRIS autorisées ─────────────────────────────────
// Doit correspondre à /api/scoring/iris-columns
const ALLOWED_IRIS_COLUMNS = new Set([
  'population',
  'pop_0_14', 'pop_15_29', 'pop_30_44', 'pop_45_59', 'pop_60_74', 'pop_75_plus',
  'nb_csp_cadre', 'nb_csp_employe', 'nb_csp_ouvrier',
  // Colonnes présentes dans le schéma mais non encore renseignées (réservées pour import futur)
  // 'rev_median', 'taux_diplome_sup', 'nb_diplome_sup', 'taux_chomage', 'taux_proprio',
]);

// GET /api/iris/geojson?bbox=west,south,east,north&colonne=pop_15_29&simplify=0.0005
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const bbox    = searchParams.get('bbox');
  const colonne = searchParams.get('colonne') ?? '';
  const simplify = parseFloat(searchParams.get('simplify') ?? '0.0005');

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

  // ── Validation simplify ──────────────────────────────────────────────────
  const safeSimplify = isNaN(simplify) ? 0.0005 : Math.max(0, Math.min(simplify, 0.01));

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_iris_geojson_by_bbox', {
    p_west:     west,
    p_south:    south,
    p_east:     east,
    p_north:    north,
    p_colonne:  safeColonne,
    p_simplify: safeSimplify,
    p_max_rows: 5000,
  });

  if (error) {
    console.error('[iris/geojson] RPC error:', error.message);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }

  // Détecter si le résultat a été tronqué (cap 5000)
  const geojson = data as { type: string; features: unknown[] } | null;
  const featureCount = geojson?.features?.length ?? 0;
  const truncated = featureCount >= 5000;

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
