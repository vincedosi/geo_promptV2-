/**
 * GET /api/insee-variables/[code]/values?bbox=minLng,minLat,maxLng,maxLat
 *
 * Retourne les valeurs de la variable INSEE demandée, pour les CPs dans le bbox.
 *   • Si bbox fourni : filtre via ref_codes_postaux (intersection ST_Intersects).
 *   • Sinon : renvoie TOUTES les valeurs (utilisé pour la France entière en démo).
 *
 * Format : { values: { "75001": 23.4, "92100": 18.7, … }, count, min, max }
 *
 * Cache 1h (data publique stable).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const SUPPORTED = new Set(['abstention_pres_2022']);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { code } = await params;
  if (!SUPPORTED.has(code)) {
    return NextResponse.json({ error: 'unknown_variable', code }, { status: 404 });
  }

  const url = new URL(request.url);
  const bbox = url.searchParams.get('bbox'); // "minLng,minLat,maxLng,maxLat" ou null

  const supabase = createAdminClient();

  if (code === 'abstention_pres_2022') {
    let cpFilter: string[] | null = null;

    if (bbox) {
      const parts = bbox.split(',').map(Number);
      if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
        return NextResponse.json({ error: 'invalid_bbox' }, { status: 400 });
      }
      const { data: cpsInBbox, error: bboxErr } = await supabase.rpc('get_cps_in_bbox', {
        p_min_lng: parts[0], p_min_lat: parts[1],
        p_max_lng: parts[2], p_max_lat: parts[3],
      });
      if (bboxErr) return NextResponse.json({ error: bboxErr.message }, { status: 500 });
      const cps = (cpsInBbox ?? []) as Array<{ code_postal: string }>;
      cpFilter = cps.map(c => c.code_postal);
      if (cpFilter.length === 0) {
        return NextResponse.json({ values: {}, count: 0, min: null, max: null });
      }
    }

    // Pagine au cas où > 1000 rows (PostgREST limite par défaut)
    const allRows: Array<{ code_postal: string; taux_abstention: number }> = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      let q = supabase
        .from('dataset_abstention_2022')
        .select('code_postal, taux_abstention');
      if (cpFilter) q = q.in('code_postal', cpFilter);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const values: Record<string, number> = {};
    let min = Infinity, max = -Infinity;
    for (const row of allRows) {
      const v = Number(row.taux_abstention);
      values[row.code_postal] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    return NextResponse.json(
      {
        values,
        count: allRows.length,
        min: allRows.length > 0 ? min : null,
        max: allRows.length > 0 ? max : null,
      },
      { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
  }

  return NextResponse.json({ error: 'unknown_variable' }, { status: 404 });
}
