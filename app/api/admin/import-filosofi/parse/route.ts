/**
 * POST /api/admin/import-filosofi/parse
 * Analyse un fichier .parquet Filosofi INSEE.
 * Retourne : colonnes détectées, colonne idcar, nb de lignes, aperçu 5 lignes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { parquetMetadata, parquetRead } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

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

    const buffer = Buffer.from(await file.arrayBuffer());
    // Build AsyncBuffer from Node Buffer (hyparquet interface: { byteLength, slice })
    const asyncBuf = {
      byteLength: buffer.byteLength,
      slice: (start: number, end: number) => Promise.resolve(buffer.buffer.slice(buffer.byteOffset + start, buffer.byteOffset + end)),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = parquetMetadata(asyncBuf as any);

    // Colonnes du fichier
    const columns: string[] = meta.schema
      .filter(f => f.num_children === undefined || f.num_children === null)
      .map(f => f.name)
      .filter(n => n !== 'schema');

    // Nombre de lignes
    const rowCount = Number(meta.num_rows);

    // Détecter la colonne idcar
    const idcarColumn = IDCAR_CANDIDATES.find(c => columns.includes(c)) ?? null;

    // Colonnes indicateurs (non-idcar, non-géo)
    const indicatorColumns = columns.filter(c => !EXCLUDED.has(c));

    // Aperçu 5 premières lignes
    const preview: Record<string, unknown>[] = [];
    await parquetRead({
      file: asyncBuf as Parameters<typeof parquetRead>[0]['file'],
      compressors,
      rowStart: 0,
      rowEnd: Math.min(5, rowCount),
      onComplete: (rows) => {
        for (const row of rows) {
          const obj: Record<string, unknown> = {};
          columns.forEach((col, i) => { obj[col] = row[i]; });
          preview.push(obj);
        }
      },
    });

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
