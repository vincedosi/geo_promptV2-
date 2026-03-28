/**
 * GET /api/correlation/categories
 * Retourne les catégories POI disponibles dynamiquement (depuis poi_france).
 * Auth : protégé par le middleware Next.js (cookie session) — pas besoin de requireAdmin.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createAdminClient();

    const [catResult, sigmaResult] = await Promise.all([
      supabase.rpc('get_poi_categories'),
      supabase.from('poi_accessibility_config').select('categorie, sigma_km'),
    ]);

    if (catResult.error) throw catResult.error;

    // Build sigma lookup map (categorie → sigma_km)
    const sigmaMap = new Map<string, number>();
    for (const row of sigmaResult.data ?? []) {
      sigmaMap.set(row.categorie, row.sigma_km);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enriched = (catResult.data ?? []).map((cat: any) => ({
      ...cat,
      sigma_km: sigmaMap.get(cat.key) ?? 5.0,
    }));

    return NextResponse.json(enriched);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
