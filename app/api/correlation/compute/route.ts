/**
 * POST /api/correlation/compute
 * Calcule la corrélation spatiale.
 * Body : { mode?, poi_category?, iris_metric?, metric_x?, metric_y?, departements?, limit?, no_limit? }
 * mode = 'iris_poi' (défaut) | 'iris_iris'
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      mode         = 'iris_poi',
      poi_category,
      iris_metric  = 'population',
      sigma_km,
      metric_x,
      metric_y,
      departements = null,
      limit        = 2000,
      no_limit     = false,
    } = body as {
      mode?:         string;
      poi_category?: string;
      iris_metric?:  string;
      sigma_km?:     number;
      metric_x?:     string;
      metric_y?:     string;
      departements?: string[] | null;
      limit?:        number;
      no_limit?:     boolean;
    };

    const supabase = createAdminClient();
    const deps = departements && departements.length > 0 ? departements : null;

    // ── Mode IRIS × IRIS ──────────────────────────────────────────────────────
    if (mode === 'iris_iris') {
      if (!metric_x || !metric_y) {
        return NextResponse.json({ error: 'metric_x et metric_y requis' }, { status: 400 });
      }

      const rpcParams = { p_metric_x: metric_x, p_metric_y: metric_y, p_dep: null, p_deps: deps };

      if (no_limit) {
        // JSON scalaire — contourne max-rows PostgREST
        const { data, error } = await supabase.rpc('get_iris_iris_residual_inputs', rpcParams);
        if (error) throw error;
        // Remapper metric_x → metric_value, metric_y → poi_count
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (data as any[] ?? []).map((r: any) => ({
          code_iris:    r.code_iris,
          nom_iris:     r.nom_iris ?? '',
          metric_value: Number(r.metric_x),
          poi_count:    Number(r.metric_y),
          centroid_lat: r.centroid_lat ?? null,
          centroid_lng: r.centroid_lng ?? null,
        }));
        return NextResponse.json(rows);
      }

      const { data, error } = await supabase.rpc('correlation_iris_iris', {
        ...rpcParams, p_limit: limit, p_no_limit: false,
      });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = ((data as any[]) ?? []).map((r: any) => ({
        code_iris:    r.code_iris,
        nom_iris:     r.nom_iris ?? '',
        metric_value: Number(r.metric_x),
        poi_count:    Number(r.metric_y),
        centroid_lat: r.centroid_lat ?? null,
        centroid_lng: r.centroid_lng ?? null,
      }));
      return NextResponse.json(rows);
    }

    // ── Mode IRIS × POI — score Gaussien ─────────────────────────────────────
    if (!poi_category) {
      return NextResponse.json({ error: 'poi_category requis' }, { status: 400 });
    }

    if (!deps) {
      return NextResponse.json(
        { error: 'Un filtre département est requis pour le mode IRIS × POI.' },
        { status: 400 }
      );
    }

    const rpcParams = {
      p_poi_category: poi_category,
      p_iris_metric:  iris_metric,
      p_sigma_km:     sigma_km ?? 5.0,
      p_dep:          null,
      p_deps:         deps,
    };

    if (no_limit) {
      // JSON scalaire — contourne max-rows PostgREST
      const { data, error } = await supabase.rpc('get_accessibility_inputs', rpcParams);
      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    const { data, error } = await supabase.rpc('compute_poi_accessibility', {
      ...rpcParams, p_limit: limit, p_no_limit: false,
    });
    if (error) throw error;
    return NextResponse.json(data ?? []);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
