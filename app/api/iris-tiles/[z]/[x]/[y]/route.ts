import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';

export const dynamic = 'force-dynamic';

const ALLOWED_COLS = new Set(IRIS_DB_COLUMNS.map(c => c.name));

type Params = { z: string; x: string; y: string };

export async function GET(
  req: NextRequest,
  { params }: { params: Params },
) {
  const z = parseInt(params.z);
  const x = parseInt(params.x);
  const y = parseInt(params.y);
  const col = req.nextUrl.searchParams.get('col') ?? 'population';

  if (!ALLOWED_COLS.has(col)) {
    return NextResponse.json({ error: `Colonne invalide: ${col}` }, { status: 400 });
  }
  if ([z, x, y].some(n => isNaN(n) || n < 0)) {
    return NextResponse.json({ error: 'Coordonnées invalides' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_iris_tile', {
    z, x, y, p_col: col,
  });

  if (error) {
    console.error('[iris-tiles]', error.message);
    return new NextResponse(null, { status: 500 });
  }

  const buffer = data
    ? Buffer.from(data as string, 'base64')
    : Buffer.alloc(0);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type':  'application/x-protobuf',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
