/**
 * POST /api/coverage-total
 *
 * Couverture dédupliquée totale via compute_coverage_fast (lecture isochrones_cache en DB).
 * Synchrone, pas d'Inngest. Body: { categorie, mode, metric, duration }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { categorie, mode = 'drive', metric = 'ind', duration = 30 } = await req.json();
    if (!categorie) return NextResponse.json({ error: 'categorie requis' }, { status: 400 });

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('compute_coverage_fast', {
      p_categorie: categorie,
      p_mode:      mode,
      p_column:    metric,
      p_level:     duration,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ total: Number(data) || 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
