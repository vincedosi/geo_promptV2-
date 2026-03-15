/**
 * POST /api/coverage-breakdown
 * Calcule la couverture audience par POI (batch SQL, une seule requête).
 * Body: { poiGroups: { id, nom, geometries }[], metric: string }
 * Response: { results: { id, nom, coverage }[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { poiGroups, metric = 'ind' } = await req.json() as {
      poiGroups: { id: string; nom: string; geometries: string[] }[];
      metric?:   string;
    };

    if (!Array.isArray(poiGroups) || poiGroups.length === 0) {
      return NextResponse.json({ error: 'poiGroups[] requis' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const groups = poiGroups.map(p => ({
      id:         p.id,
      geometries: p.geometries.filter(Boolean),
    }));

    const { data, error } = await supabase.rpc('calculate_coverage_per_group', {
      p_groups: groups,
      p_column: metric,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const resultMap = new Map<string, number>(
      (data as { group_id: string; coverage: number }[]).map(r => [r.group_id, r.coverage])
    );

    const results = poiGroups
      .map(p => ({ id: p.id, nom: p.nom, coverage: resultMap.get(p.id) ?? 0 }))
      .sort((a, b) => b.coverage - a.coverage);

    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
