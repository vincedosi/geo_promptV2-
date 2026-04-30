/**
 * GET /api/iris/values?col=taux_diplome_sup
 * Retourne { values: { [code_iris]: number } } pour tous les IRIS ayant une valeur non-nulle.
 * Utilisé par useMapLayers pour setFeatureState (choroplèthe dynamique depuis DB).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';

export const dynamic = 'force-dynamic';

const ALLOWED_COLS = new Set(IRIS_DB_COLUMNS.map(c => c.name));

export async function GET(req: NextRequest) {
  const col = req.nextUrl.searchParams.get('col') ?? '';
  if (!ALLOWED_COLS.has(col)) {
    return NextResponse.json({ error: `Colonne invalide: ${col}` }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('iris')
    .select(`code_iris,${col}`)
    .not(col, 'is', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const values: Record<string, number> = {};
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const v = row[col];
    if (v !== null && v !== undefined) values[row.code_iris as string] = Number(v);
  }

  return NextResponse.json({ values }, {
    headers: { 'Cache-Control': 'public, max-age=300' }, // 5 min cache
  });
}
