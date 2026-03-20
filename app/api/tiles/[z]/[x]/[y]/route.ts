import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params;

  const zoom  = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY)) {
    return new NextResponse('Invalid tile coordinates', { status: 400 });
  }

  // Pas de carreaux en dessous du zoom 6 (carreaux_5km = résolution minimale utile)
  if (zoom < 6) {
    return new NextResponse(null, { status: 204 });
  }

  const { data, error } = await supabase.rpc('get_tile', { z: zoom, x: tileX, y: tileY });

  if (error) {
    console.error(`[tiles] z=${zoom}/${tileX}/${tileY} error:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Supabase retourne bytea en hex (\x1a6f...) ou base64
  const rawStr = String(data);
  const buffer = rawStr.startsWith('\\x')
    ? Buffer.from(rawStr.slice(2), 'hex')
    : Buffer.from(rawStr, 'base64');

  if (buffer.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
