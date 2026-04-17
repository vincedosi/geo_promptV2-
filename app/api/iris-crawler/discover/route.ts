import { NextRequest, NextResponse } from 'next/server';
import type { DiscoverResponse } from '@/lib/iris-crawler/types';

export const dynamic = 'force-dynamic';

const INSEE_BASE = 'https://www.insee.fr';
const TIMEOUT_MS = 15_000;

/** Domaines autorisés pour les URLs découvertes (anti-SSRF) */
const ALLOWED_DISCOVER_DOMAINS = [
  'www.insee.fr',
  'insee.fr',
  'data.gouv.fr',
  'www.data.gouv.fr',
  'static.data.gouv.fr',
];

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_DISCOVER_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith('.' + d)
    );
  } catch {
    return false;
  }
}

// GET /api/iris-crawler/discover?pageId=8647014&pageType=statistiques
export async function GET(req: NextRequest) {
  const pageId   = req.nextUrl.searchParams.get('pageId');
  const pageType = req.nextUrl.searchParams.get('pageType') ?? 'statistiques';

  if (!pageId) {
    return NextResponse.json({ urls: [], error: 'pageId requis' } satisfies DiscoverResponse, { status: 400 });
  }

  const pageUrl = pageType === 'information'
    ? `${INSEE_BASE}/fr/information/${pageId}`
    : `${INSEE_BASE}/fr/statistiques/${pageId}`;

  let html = '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'GENESIS/1.0 (geo.prompt data crawler)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return NextResponse.json({
        urls: [],
        error: `HTTP ${res.status} sur ${pageUrl}`,
      } satisfies DiscoverResponse);
    }
    html = await res.text();
  } catch (e) {
    return NextResponse.json({
      urls: [],
      error: `Erreur réseau : ${e instanceof Error ? e.message : String(e)}`,
    } satisfies DiscoverResponse);
  }

  // Extraire le titre de la page
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const pageTitle = titleMatch?.[1]?.trim().replace(/\s*\|.*$/, '');

  // Chercher tous les liens vers des ZIP ou CSV
  const found: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  /** Helper: resolve raw href → absolute URL, validate domain, deduplicate */
  function tryAdd(raw: string) {
    const url = raw.startsWith('http') ? raw : `${INSEE_BASE}${raw}`;
    if (seen.has(url) || !isAllowedUrl(url)) return;
    seen.add(url);
    const name = url.split('/').pop() ?? url;
    found.push({ url, name });
  }

  // Pattern 1 : fichiers ZIP avec "csv" dans le nom
  const zipRegex = /href="([^"]*\/fichier\/[^"]*(?:csv|CSV)[^"]*\.zip[^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = zipRegex.exec(html)) !== null) tryAdd(m[1]);

  // Pattern 2 : tous les ZIP (même sans "csv" explicite)
  if (found.length === 0) {
    const allZipRegex = /href="([^"]*\.zip[^"]*)"/gi;
    while ((m = allZipRegex.exec(html)) !== null) tryAdd(m[1]);
  }

  // Pattern 3 : liens download directs CSV
  const csvRegex = /href="([^"]*\.csv[^"]*)"/gi;
  while ((m = csvRegex.exec(html)) !== null) tryAdd(m[1]);

  // Pattern 4 : liens téléchargement génériques INSEE (/telechargement/ ou /fichier/)
  if (found.length === 0) {
    const dlRegex = /href="([^"]*(?:telechargement|fichier)[^"]*\.[a-z]{2,4}[^"]*)"/gi;
    while ((m = dlRegex.exec(html)) !== null) {
      if (m[1].includes('css') || m[1].includes('js')) continue;
      tryAdd(m[1]);
    }
  }

  return NextResponse.json({
    urls: found,
    pageTitle,
  } satisfies DiscoverResponse);
}
