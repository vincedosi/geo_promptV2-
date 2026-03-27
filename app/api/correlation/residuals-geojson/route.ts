/**
 * POST /api/correlation/residuals-geojson
 * Retourne les géométries IRIS simplifiées pour une liste de code_iris.
 * Body : { codes: string[] }
 * Auth : protégé par le middleware Next.js.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { codes?: unknown };
    const { codes } = body;

    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json({ error: 'codes requis' }, { status: 400 });
    }

    const limitedCodes = (codes as string[]).slice(0, 55000);
    const supabase = createAdminClient();

    // Tolérance adaptive : plus les polygones sont nombreux, plus on simplifie
    const tolerance = limitedCodes.length > 10000 ? 0.005
      : limitedCodes.length > 3000  ? 0.002
      : 0.001;

    const { data, error } = await supabase.rpc('get_iris_geojson_by_codes', {
      p_codes: limitedCodes,
      p_simplify_tolerance: tolerance,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
