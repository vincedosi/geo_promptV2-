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
  '/api/map/pois',
  '/api/map/poi-natures',
  '/api/map/ooh',
  '/api/map/transport',
  '/api/map/tmja',
  // Note: /api/map/categories est public intentionnellement (données non sensibles)
  '/api/admin',
  '/api/iris-crawler',
  '/api/iris-tiles-proxy',
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
  '/api/iris-import',
  '/api/isochrone-battle',
  '/api/isochrone-battle-v2',
  '/api/isochrone-cache-check',
  '/api/providers',
  '/api/saved-maps',
  '/api/smart-prompt',
  '/api/correlation',
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

  // ── Routes API protégées ─────────────────────────────────────────────────
  // NOTE SÉCURITÉ : getSession() valide le JWT localement (cookie) sans appel
  // réseau vers Supabase Auth. Cela signifie qu'un token volé reste valide
  // jusqu'à expiration même après déconnexion côté serveur. C'est un choix
  // délibéré pour éviter les 409 "Too many concurrent token refresh requests"
  // quand le front envoie plusieurs requêtes API en parallèle (cf. incident
  // 2026-03-28 dans CLAUDE.md). Les sessions ont un TTL court (1h par défaut).
  // Pour les opérations sensibles (admin, delete), une vérification de rôle
  // additionnelle via requireAdmin() est effectuée dans la route elle-même.
  if (isProtectedApi(pathname)) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Non authentifié — fournissez un token Bearer valide.' },
        { status: 401 }
      );
    }
    return response;
  }

  // ── Pages protégées ───────────────────────────────────────────────────────
  // getUser() valide le token côté Supabase et rafraîchit si nécessaire.
  // Un seul appel par navigation → pas de problème de concurrence.
  if (isProtectedPage(pathname)) {
    const { data: { user } } = await supabase.auth.getUser();
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
    '/api/iris-tiles-proxy/:path*',
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
    '/api/iris-import/:path*',
    '/api/isochrone-battle/:path*',
    '/api/isochrone-battle-v2/:path*',
    '/api/isochrone-cache-check/:path*',
    '/api/providers/:path*',
    '/api/saved-maps/:path*',
    '/api/smart-prompt/:path*',
    '/api/correlation/:path*',
  ],
};
