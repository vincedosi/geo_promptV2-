/**
 * POST /api/admin/sync-iris-poi-counts
 * Recalcule iris_poi_counts pour une ou toutes les catégories POI.
 * À appeler après chaque import de POI.
 * Body : { categorie?: string }  — si absent, recalcule toutes les catégories connues.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes (Vercel Pro)

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { categorie?: string };
    const supabase = createAdminClient();

    if (body.categorie) {
      // Recalcul d'une seule catégorie
      const { data, error } = await supabase.rpc(
        'compute_iris_poi_counts_category',
        { p_categorie: body.categorie }
      );
      if (error) throw error;
      return NextResponse.json({
        ok: true,
        categorie: body.categorie,
        iris_updated: data,
      });
    }

    // Recalcul de toutes les catégories existantes dans poi_france
    const { data: cats, error: catsErr } = await supabase
      .from('poi_france')
      .select('categorie')
      .not('categorie', 'is', null);

    if (catsErr) throw catsErr;

    const categories = [...new Set((cats ?? []).map((r: { categorie: string }) => r.categorie))];
    const results: Record<string, number> = {};

    for (const cat of categories) {
      const { data, error } = await supabase.rpc(
        'compute_iris_poi_counts_category',
        { p_categorie: cat }
      );
      if (error) {
        results[cat] = -1;
      } else {
        results[cat] = data as number;
      }
    }

    // Rafraîchir aussi iris_metrics_mv si elle existe
    await supabase.rpc('refresh_iris_metrics_mv').catch(() => null);

    return NextResponse.json({ ok: true, results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
