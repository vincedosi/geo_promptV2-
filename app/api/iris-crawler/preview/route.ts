import { NextRequest, NextResponse } from 'next/server';
import { loadBase } from '@/lib/iris-crawler/storage';
import type { PreviewResponse, ColumnStats } from '@/lib/iris-crawler/types';

export const dynamic = 'force-dynamic';

// GET /api/iris-crawler/preview?catalogId=pop-2022&limit=20
export async function GET(req: NextRequest) {
  const catalogId = req.nextUrl.searchParams.get('catalogId');
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10), 200);

  if (!catalogId) {
    return NextResponse.json({ error: 'catalogId requis' }, { status: 400 });
  }

  const base = await loadBase(catalogId);
  if (!base) {
    return NextResponse.json({ error: `Base "${catalogId}" non téléchargée` }, { status: 404 });
  }

  // Calcul des stats par colonne
  const columnStats: ColumnStats[] = base.headers.map(col => {
    const isGeo = base.geoColumns.includes(col);
    const values = base.rows.map(r => r[col]);
    const nullCount = values.filter(v => v === null).length;
    const nullPct = Math.round((nullCount / base.rowCount) * 100);

    const stat: ColumnStats = {
      name: col,
      type: isGeo ? 'geo' : 'data',
      nullCount,
      nullPct,
      samples: values.slice(0, 5),
    };

    if (!isGeo) {
      const nums = values.filter((v): v is number => typeof v === 'number');
      if (nums.length > 0) {
        stat.min = Math.min(...nums);
        stat.max = Math.max(...nums);
      }
    }

    return stat;
  });

  const response: PreviewResponse = {
    catalogId: base.catalogId,
    csvFileName: base.csvFileName,
    downloadedAt: base.downloadedAt,
    headers: base.headers,
    geoColumns: base.geoColumns,
    dataColumns: base.dataColumns,
    totalRows: base.rowCount,
    rows: base.rows.slice(0, limit),
    columnStats,
    fileSizeBytes: base.fileSizeBytes,
  };

  return NextResponse.json(response);
}
