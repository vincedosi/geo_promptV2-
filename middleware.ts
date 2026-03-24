/**
 * GENESIS — Middleware Next.js
 *
 * Protège les routes métier : vérifie la présence d'un token de session
 * avant d'autoriser l'accès aux pages et aux API.
 *
 * Stratégie :
 * - Lecture du token depuis Authorization: Bearer ou cookie Supabase
 * - En développement (NODE_ENV=development) : bypass total si pas de token
 *   (console.warn uniquement) — ne casse jamais le dev local
 * - En production sans token :
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
const PROTECTED_API_PREFIXES  = ['/api/chat', '/api/scoring', '/api/map', '/api/admin', '/api/iris-crawler'];
const PROTECTED_PAGE_PREFIXES = ['/map', '/copilote'];

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
    const cookieVal = request.cookies.get(`sb-${projectRef}-auth-token`)?.value;
    if (cookieVal) {
      try {
        const parsed = JSON.parse(decodeURIComponent(cookieVal)) as { access_token?: string };
        if (parsed.access_token) return parsed.access_token;
      } catch {
        // cookie malformé — ignorer
      }
    }
  }

  return null;
}

// ── Middleware principal ───────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDev        = process.env.NODE_ENV === 'development';
  const token        = extractToken(request);

  // ── Routes API protégées ──────────────────────────────────────────────────
  if (isProtectedApi(pathname)) {
    if (!token) {
      if (isDev) {
        console.warn(`[middleware] DEV — pas de session pour ${pathname} — bypass`);
        return NextResponse.next();
      }
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
      if (isDev) {
        console.warn(`[middleware] DEV — pas de session pour ${pathname} — bypass`);
        return NextResponse.next();
      }
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
// Exclut les assets statiques, _next, favicon, etc.
export const config = {
  matcher: [
    '/map/:path*',
    '/copilote/:path*',
    '/api/chat/:path*',
    '/api/scoring/:path*',
    '/api/map/:path*',
    '/api/admin/:path*',
    '/api/iris-crawler/:path*',
  ],
};
