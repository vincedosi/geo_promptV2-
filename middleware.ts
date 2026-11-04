/**
 * GENESIS — Middleware Next.js
 *
 * Protège les routes métier via @supabase/ssr :
 * - Valide le token JWT (appel getUser, pas juste présence du cookie)
 * - Rafraîchit le token automatiquement si expiré
 * - Sans token valide :
 *     API  → 401 JSON
 *     Page → 401 texte (MESSAGE_PAGE_SANS_SESSION)
 *
 * Il n'y a PLUS de page de connexion (décision du propriétaire, 2026-11-05) :
 * le shell AIDA ouvre la session. Une page sans session ne redirige donc
 * vers rien — elle dit pourquoi elle ne s'affiche pas.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── Routes protégées ───────────────────────────────────────────────────────────
const PROTECTED_API_PREFIXES = [
  '/api/map/pois',
  '/api/map/poi-natures',
  '/api/map/ooh',
  '/api/map/transport',
  // Note: /api/map/categories est public intentionnellement (données non sensibles)
  '/api/admin',
  '/api/iris-crawler',
  // Tuiles vectorielles : les deux familles sont traitées à l'identique.
  // MapLibre les requête en same-origin, les cookies de session sont donc
  // transmis — c'est déjà le cas de /api/tiles, en service et fonctionnel.
  // Les tuiles IRIS passent par /api/tiles/iris (TER-001, 2026-09-11) —
  // volontairement sous ce prefixe, deja couvert, pour ne pas avoir a
  // toucher ce fichier. Le PMTiles qu'evoquait ce commentaire n'a jamais
  // atteint la production.
  '/api/tiles',
  '/api/tmja-tiles',
  // Couvre aussi, par startsWith, toute route /api/iris-*.
  '/api/iris',
  // Clustering POI x Filosofi, restaure le 2026-09-12 apres suppression du
  // 2026-07-05. Les 13 routes lisent et ECRIVENT des modeles et des jobs :
  // sans cette ligne ET sans l'entree du matcher plus bas, elles seraient
  // ouvertes. Autorisation explicite de Vincent pour toucher ce fichier.
  '/api/poi-clusters',
  '/api/isochrone-battle',
  '/api/isochrone-battle-v2',
  '/api/isochrone-cache-check',
  '/api/saved-maps',
  '/api/radio',
  // Referentiel geo : consommé par lib/geo/use-ref-geo.ts en
  // fetch(..., { credentials: 'include' }) — les cookies sont transmis.
  '/api/ref',
];

const PROTECTED_PAGE_PREFIXES = [
  '/map',
  '/dashboard',
  '/admin',
  '/demo',
];

/** Réponse d'une PAGE protégée sans session : il n'y a plus d'écran de connexion vers lequel rediriger. */
const MESSAGE_PAGE_SANS_SESSION =
  'Session absente : la connexion est gérée par AIDA. '
  + "En développement local, lancez l'app avec la connexion automatique.";

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
      return new NextResponse(MESSAGE_PAGE_SANS_SESSION, {
        status: 401,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return response;
  }

  return response;
}

// ── Matcher ───────────────────────────────────────────────────────────────────
// Exclut /api/inngest (webhook propre) et /api/auth/* (flux OAuth Supabase).
//
// ⚠ Le matcher décide si le middleware s'exécute ; les listes ci-dessus
// décident s'il protège. Une route absente d'ICI n'est JAMAIS protégée, même
// si son préfixe figure dans PROTECTED_API_PREFIXES. Toute nouvelle route
// protégée doit donc être ajoutée AUX DEUX endroits.
//
// Le matcher raisonne par segment : '/api/iris/:path*' ne couvre pas
// '/api/iris-crawler' — d'où sa ligne dédiée.
export const config = {
  matcher: [
    '/map/:path*',
    '/dashboard/:path*',
    '/admin/:path*',
    '/demo/:path*',
    '/api/map/:path*',
    '/api/admin/:path*',
    '/api/iris-crawler/:path*',
    '/api/tiles/:path*',
    '/api/tmja-tiles/:path*',
    '/api/iris/:path*',
    '/api/poi-clusters/:path*',
    '/api/isochrone-battle/:path*',
    '/api/isochrone-battle-v2/:path*',
    '/api/isochrone-cache-check/:path*',
    '/api/saved-maps/:path*',
    '/api/radio/:path*',
    '/api/ref/:path*',
  ],
};
