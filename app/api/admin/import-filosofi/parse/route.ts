/**
 * POST /api/admin/import-filosofi/parse
 * Analyse un fichier .parquet Filosofi INSEE.
 * Retourne : colonnes détectées, colonne idcar, nb de lignes, aperçu 5 lignes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

import Papa from 'papaparse';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Colonnes idcar connues dans les exports Filosofi INSEE
const IDCAR_CANDIDATES = ['idcar', 'Idcar', 'IDCAR', 'idcar_200m', 'idcar_1km', 'Idcar_200m', 'Idcar_1km'];

// Colonnes à exclure de la détection indicateurs (géo, admin)
const EXCLUDED = new Set(['idcar', 'Idcar', 'IDCAR', 'idcar_200m', 'idcar_1km', 'Idcar_200m', 'Idcar_1km',
  'i_est_200', 'i_est_1km', 'x_wgs84', 'y_wgs84', 'x_lam', 'y_lam', 'lat', 'lon', 'lng']);

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return adminUnauthorized();

  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
    if (!file.name.endsWith('.csv')) return NextResponse.json({ error: 'Seuls les fichiers .csv sont acceptés' }, { status: 400 });

    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (parsed.errors.length > 0) {
      return NextResponse.json({ error: parsed.errors[0].message }, { status: 400 });
    }
    const columns = parsed.meta.fields || [];
    const rowCount = parsed.data.length;
    const idcarColumn = IDCAR_CANDIDATES.find(c => columns.includes(c)) ?? null;
    const indicatorColumns = columns.filter(c => !EXCLUDED.has(c));
    const preview = parsed.data.slice(0, 5);

    return NextResponse.json({
      rowCount,
      columns,
      idcarColumn,
      indicatorColumns,
      preview,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue';
    console.error('[import-filosofi/parse]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
