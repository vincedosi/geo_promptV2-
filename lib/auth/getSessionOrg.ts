/**
 * GENESIS — getSessionOrg
 *
 * Helper server-side : identifie l'utilisateur depuis la requête et retourne
 * son organization_id + role depuis la table `profiles`.
 *
 * Pattern cohérent avec getUserFromRequest() (lib/auth.ts) :
 * lit le Bearer token dans le header Authorization.
 *
 * Fallback cookie : si pas de header, tente le cookie Supabase
 * `sb-<projectRef>-auth-token` (utile quand @supabase/ssr est absent
 * mais que le browser stocke un cookie de session tiers).
 *
 * Usage :
 *   const session = await getSessionOrg(request);
 *   if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
 */
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import type { UserRole } from '@/types/admin';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SessionOrg {
  userId: string;
  orgId:  string | null;
  role:   UserRole;
}

// ── Helpers privés ─────────────────────────────────────────────────────────────

/**
 * Lit le jeton d'accès dans la valeur d'un cookie de session Supabase.
 *
 * Deux formats : `base64-<base64url du JSON>`, celui qu'écrit `@supabase/ssr`
 * 0.5.x PAR DÉFAUT (`createBrowserClient`, donc le navigateur) ; et le JSON
 * brut, encodé en URI, des versions précédentes.
 *
 * Jusqu'au 2026-10-08 seul le second était lu : la session du navigateur
 * n'était JAMAIS reconnue par cookie, et toute route appelée par un `fetch`
 * nu se croyait sans session — ce qui, tant que la règle d'autorisation
 * ouvrait sans session, servait les données de toutes les organisations.
 */
function jetonDuCookie(valeur: string): string | null {
  try {
    const json = valeur.startsWith('base64-')
      ? Buffer.from(valeur.slice('base64-'.length), 'base64url').toString('utf8')
      : decodeURIComponent(valeur);
    const parsed = JSON.parse(json) as { access_token?: string };
    return parsed.access_token ?? null;
  } catch {
    return null; // malformé
  }
}

/**
 * Extrait le JWT depuis la requête entrante :
 * 1. Header Authorization: Bearer <token>
 * 2. Cookie sb-<projectRef>-auth-token (fallback SSR partiel)
 */
function extractToken(request: NextRequest): string | null {
  // 1. Bearer token (pattern principal du projet)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // 2. Fallback cookie — gère le format simple ET chunké (@supabase/ssr)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const match       = supabaseUrl.match(/https?:\/\/([^.]+)\./);
  const projectRef  = match?.[1] ?? '';

  if (projectRef) {
    const base = `sb-${projectRef}-auth-token`;

    // Cookie simple
    const simple = request.cookies.get(base)?.value;
    if (simple) {
      const jeton = jetonDuCookie(simple);
      if (jeton) return jeton;
    }

    // Cookie chunké (.0, .1, ...) — format @supabase/ssr
    const chunks: string[] = [];
    for (let i = 0; i < 10; i++) {
      const chunk = request.cookies.get(`${base}.${i}`)?.value;
      if (!chunk) break;
      chunks.push(chunk);
    }
    if (chunks.length > 0) {
      // @supabase/ssr découpe la valeur ENTIÈRE, préfixe `base64-` compris :
      // on recolle avant de décoder.
      const jeton = jetonDuCookie(chunks.join(''));
      if (jeton) return jeton;
    }
  }

  return null;
}

// ── Export principal ───────────────────────────────────────────────────────────

/**
 * Lit la session depuis la requête et retourne { userId, orgId, role } ou null.
 *
 * Ne throws jamais — retourne null en cas d'erreur pour ne pas casser
 * les routes qui font un check optionnel.
 */
export async function getSessionOrg(request: NextRequest): Promise<SessionOrg | null> {
  try {
    const token = extractToken(request);
    if (!token) return null;

    const supabase = createAdminClient();

    // Valider le JWT et récupérer l'utilisateur Supabase Auth
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return null;

    // Récupérer organization_id + role depuis la table profiles
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) {
      // Utilisateur authentifié mais sans profil — retourner userId seulement
      return { userId: user.id, orgId: null, role: 'client' };
    }

    return {
      userId: user.id,
      orgId:  profile.organization_id ?? null,
      role:   (profile.role as SessionOrg['role']) ?? 'client',
    };
  } catch {
    return null;
  }
}
