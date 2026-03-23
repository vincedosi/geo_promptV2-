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

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SessionOrg {
  userId: string;
  orgId:  string | null;
  role:   'super_admin' | 'admin' | 'client';
}

// ── Helpers privés ─────────────────────────────────────────────────────────────

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

  // 2. Fallback cookie (Supabase JS v2 peut en écrire un dans certains contextes)
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
