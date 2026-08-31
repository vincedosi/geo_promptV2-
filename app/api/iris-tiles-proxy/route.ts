/**
 * GET /api/iris-tiles-proxy
 * Proxy PMTiles depuis GitHub Releases — forward les Range requests.
 * GitHub Releases ne sert pas les headers CORS, ce proxy les ajoute.
 */
import { logger } from '@/lib/logger';
export const dynamic = 'force-dynamic';

const PMTILES_URL =
  'https://github.com/vincedosi/geo_promptV2-/releases/download/iris-pmtiles-latest/iris.pmtiles';

export async function GET(request: Request) {
  const headers: HeadersInit = {
    'Authorization': `token ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/octet-stream',
  };

  const range = request.headers.get('Range');
  if (range) headers['Range'] = range;

  const upstream = await fetch(PMTILES_URL, { headers, redirect: 'follow' });
  logger.debug('PROXY', `GitHub response status ${upstream.status}`);
  logger.debug('PROXY', `GitHub response url ${upstream.url}`);

  const resHeaders: Record<string, string> = {
    'Content-Type':                'application/octet-stream',
    'Accept-Ranges':               'bytes',
    'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://genesis.vercel.app',
    'Cache-Control':               'public, max-age=86400',
  };

  const contentLength = upstream.headers.get('Content-Length');
  if (contentLength) resHeaders['Content-Length'] = contentLength;

  const contentRange = upstream.headers.get('Content-Range');
  if (contentRange) resHeaders['Content-Range'] = contentRange;

  return new Response(upstream.body, {
    status:  upstream.status,
    headers: resHeaders,
  });
}
