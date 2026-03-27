/**
 * POST /api/correlation/compute
 * Calcule la corrélation spatiale POI × IRIS.
 * Body : { poi_category, iris_metric?, departements?: string[], limit? }
 * Auth : protégé par le middleware Next.js (cookie session).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      poi_category,
      iris_metric   = 'population',
      departements  = null,
      limit         = 2000,
      no_limit      = false,
    } = body as {
      poi_category:  string;
      iris_metric?:  string;
      departements?: string[] | null;
      limit?:        number;
      no_limit?:     boolean;
    };

    if (!poi_category) {
      return NextResponse.json({ error: 'poi_category requis' }, { status: 400 });
    }

    const supabase = createAdminClient();

    if (no_limit) {
      // get_iris_residual_inputs retourne RETURNS JSON (scalaire) :
      // PostgREST voit 1 ligne → contourne le max-rows infrastructure (~5000).
      // json_agg côté SQL agrège tous les IRIS avant d'envoyer.
      const { data, error } = await supabase.rpc('get_iris_residual_inputs', {
        p_poi_category: poi_category,
        p_iris_metric:  iris_metric,
        p_dep:          null,
        p_deps:         departements && departements.length > 0 ? departements : null,
      });
      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    const { data, error } = await supabase.rpc('correlation_poi_iris', {
      p_poi_category: poi_category,
      p_iris_metric:  iris_metric,
      p_dep:          null,
      p_deps:         departements && departements.length > 0 ? departements : null,
      p_limit:        limit,
      p_no_limit:     false,
    });

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
