/**
 * GENESIS — Middleware Next.js
 *
 * Protège les routes métier : vérifie la présence d'un token de session
 * avant d'autoriser l'accès aux pages et aux API.
 *
 * Stratégie :
 * - Lecture du token depuis Authorization: Bearer ou cookie Supabase
 * - Sans token :
 *     API  → 401 JSON
 *     Page → redirect /login?redirect=<pathname>
 *
 * NOTE : Ce middleware effectue uniquement un contrôle de présence du token
 * (sans appel réseau Supabase, pour rester < 1 ms sur l'edge).
 * La validation réelle (getUser + profile) est faite dans chaque route
 * via getSessionOrg(request).
 */
import { NextResponse }   from 'next/server';
import type { NextRequest } from 'next/server';

// ── Routes protégées ───────────────────────────────────────────────────────────
const PROTECTED_API_PREFIXES = [
  '/api/chat',
  '/api/scoring',
  '/api/map',
  '/api/admin',
  '/api/iris-crawler',
  '/api/tiles',
  '/api/poi-clusters',
  '/api/analysis',
  '/api/carreaux',
  '/api/coverage-breakdown',
  '/api/coverage-jobs',
  '/api/coverage-stats',
  '/api/export',
  '/api/integration-panneaux',
  '/api/iris',
  '/api/iris-tiles',
  '/api/isochrone-battle',
  '/api/isochrone-battle-v2',
  '/api/isochrone-cache-check',
  '/api/providers',
  '/api/saved-maps',
  '/api/smart-prompt',
];

const PROTECTED_PAGE_PREFIXES = [
  '/map',
  '/copilote',
  '/dashboard',
  '/admin',
  '/clusters',
  '/integration-panneaux',
];

function isProtectedApi(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some(p => pathname.startsWith(p));
}

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some(p => pathname.startsWith(p));
}

// ── Extraction légère du token ─────────────────────────────────────────────────
// Pas de validation réseau ici — juste détecter la présence d'un token.
function extractToken(request: NextRequest): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);

  // 2. Cookie Supabase sb-<projectRef>-auth-token
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const match       = supabaseUrl.match(/https?:\/\/([^.]+)\./);
  const projectRef  = match?.[1] ?? '';

  if (projectRef) {
    const base = `sb-${projectRef}-auth-token`;

    // Supabase JS v2 : cookie simple
    const simple = request.cookies.get(base)?.value;
    if (simple) {
      try {
        const parsed = JSON.parse(decodeURIComponent(simple)) as { access_token?: string };
        if (parsed.access_token) return parsed.access_token;
      } catch { /* malformé */ }
    }

    // Supabase JS v2 : cookie chunké (.0, .1, ...)
    const chunks: string[] = [];
    for (let i = 0; i < 10; i++) {
      const chunk = request.cookies.get(`${base}.${i}`)?.value;
      if (!chunk) break;
      chunks.push(chunk);
    }
    if (chunks.length > 0) {
      try {
        const parsed = JSON.parse(decodeURIComponent(chunks.join(''))) as { access_token?: string };
        if (parsed.access_token) return parsed.access_token;
      } catch { /* malformé */ }
    }
  }

  return null;
}

// ── Middleware principal ───────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token        = extractToken(request);

  // ── Routes API protégées ──────────────────────────────────────────────────
  if (isProtectedApi(pathname)) {
    if (!token) {
      return NextResponse.json(
        { error: "Non authentifié — fournissez un token Bearer valide." },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // ── Pages protégées ───────────────────────────────────────────────────────
  if (isProtectedPage(pathname)) {
    if (!token) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

// ── Matcher ───────────────────────────────────────────────────────────────────
// Exclut /api/inngest (webhook propre) et /api/auth/* (flux OAuth Supabase).
// Exclut les assets statiques, _next, favicon, etc.
export const config = {
  matcher: [
    '/map/:path*',
    '/copilote/:path*',
    '/dashboard/:path*',
    '/admin/:path*',
    '/clusters/:path*',
    '/integration-panneaux/:path*',
    '/api/chat/:path*',
    '/api/scoring/:path*',
    '/api/map/:path*',
    '/api/admin/:path*',
    '/api/iris-crawler/:path*',
    '/api/tiles/:path*',
    '/api/poi-clusters/:path*',
    '/api/analysis/:path*',
    '/api/carreaux/:path*',
    '/api/coverage-breakdown/:path*',
    '/api/coverage-jobs/:path*',
    '/api/coverage-stats/:path*',
    '/api/export/:path*',
    '/api/integration-panneaux/:path*',
    '/api/iris/:path*',
    '/api/iris-tiles/:path*',
    '/api/isochrone-battle/:path*',
    '/api/isochrone-battle-v2/:path*',
    '/api/isochrone-cache-check/:path*',
    '/api/providers/:path*',
    '/api/saved-maps/:path*',
    '/api/smart-prompt/:path*',
  ],
};
