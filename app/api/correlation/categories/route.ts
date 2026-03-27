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
    const { data, error } = await supabase.rpc('get_poi_categories');

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
