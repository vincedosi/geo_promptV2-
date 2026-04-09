import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const tileCache = new Map<string, { buf: Buffer; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min (campaign data changes rarely)
const MAX_CACHE = 500;

function pruneCache() {
  if (tileCache.size <= MAX_CACHE) return;
  const toDelete = Math.floor(MAX_CACHE * 0.2);
  let i = 0;
  for (const k of tileCache.keys()) {
    tileCache.delete(k);
    if (++i >= toDelete) break;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params;
  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY)) {
    return new NextResponse('Invalid tile coordinates', { status: 400 });
  }

  const campaignId = req.nextUrl.searchParams.get('campaign_id');
  if (!campaignId || campaignId === 'none') {
    return new NextResponse(null, { status: 204 });
  }

  const mode = req.nextUrl.searchParams.get('mode') || 'impressions';

  // Skip very low zoom (too much data)
  if (zoom < 5) {
    return new NextResponse(null, { status: 204 });
  }


  const key = `${campaignId}/${mode}/${zoom}/${tileX}/${tileY}`;
  const now = Date.now();

  // Cache hit
  const cached = tileCache.get(key);
  if (cached && now < cached.expires) {
    return new NextResponse(cached.buf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=300',
        'X-Tile-Cache': 'HIT',
      },
    });
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_dsp_equity_tile', {
      z: zoom, x: tileX, y: tileY,
      p_campaign_id: campaignId,
      p_mode: mode,
    });

    if (error) {
      console.error(`[dsp-tiles] ${zoom}/${tileX}/${tileY} error:`, error.message);
      return new NextResponse(null, { status: 500 });
    }

    const rawStr = String(data);
    const buffer = rawStr.startsWith('\\x')
      ? Buffer.from(rawStr.slice(2), 'hex')
      : Buffer.from(rawStr, 'base64');

    if (!buffer || buffer.length === 0) {
      return new NextResponse(null, { status: 204 });
    }

    // Store in cache
    pruneCache();
    tileCache.set(key, { buf: buffer, expires: now + CACHE_TTL });

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=300',
        'X-Tile-Cache': 'MISS',
      },
    });
  } catch (err) {
    console.error('[dsp-tiles] unexpected:', err);
    return new NextResponse(null, { status: 500 });
  }
}
