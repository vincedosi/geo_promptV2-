/**
 * GENESIS — Middleware Next.js
 *
 * Protège les routes métier via @supabase/ssr :
 * - Valide le token JWT (appel getUser, pas juste présence du cookie)
 * - Rafraîchit le token automatiquement si expiré
 * - Sans token valide :
 *     API  → 401 JSON
 *     Page → redirect /login?redirect=<pathname>
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
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

// ── Middleware principal ───────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });

  // Création du client Supabase SSR avec gestion des cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Validation réelle du token (+ refresh automatique si expiré)
  const { data: { user } } = await supabase.auth.getUser();

  // ── Routes API protégées ──────────────────────────────────────────────────
  if (isProtectedApi(pathname)) {
    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié — fournissez un token Bearer valide.' },
        { status: 401 }
      );
    }
    return response;
  }

  // ── Pages protégées ───────────────────────────────────────────────────────
  if (isProtectedPage(pathname)) {
    if (!user) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  return response;
}

// ── Matcher ───────────────────────────────────────────────────────────────────
// Exclut /api/inngest (webhook propre) et /api/auth/* (flux OAuth Supabase).
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
