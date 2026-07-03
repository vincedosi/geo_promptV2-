/**
 * GENESIS — Server-side API middleware helpers
 *
 * Fournit des guards d'authentification/autorisation réutilisables
 * dans toutes les routes API. À importer côté serveur uniquement.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, isSuperAdmin, type UserProfile } from '@/lib/auth';

/**
 * Vérifie que la requête provient d'un super_admin authentifié.
 *
 * Usage dans une route :
 *   const profile = await requireAdmin(request);
 *   if (!profile) return adminUnauthorized();
 *
 * @returns Le profil si autorisé, null sinon.
 */
export async function requireAdmin(req: NextRequest): Promise<UserProfile | null> {
  const authHeader = req.headers.get('authorization');
  const profile = await getUserFromRequest(authHeader);
  return isSuperAdmin(profile) ? profile : null;
}

/**
 * Vérifie que la requête provient d'un utilisateur authentifié (tout rôle).
 *
 * Usage dans une route :
 *   const profile = await requireAuth(request);
 *   if (!profile) return authUnauthorized();
 */
export async function requireAuth(req: NextRequest): Promise<UserProfile | null> {
  const authHeader = req.headers.get('authorization');
  return getUserFromRequest(authHeader);
}

/**
 * Guard des connexions DSP (onglet API).
 *
 * Autorise TOUT membre authentifié d'une organisation (client / admin /
 * super_admin) : chaque org gère ses propres connexions DSP (DV360, TikTok…).
 *
 * Sécurité du scope : les routes DSP scopent toujours par `profile.organization_id`
 * (jamais un org_id reçu du client). Un membre ne peut donc agir QUE sur la
 * connexion de sa propre org. Le super_admin « intervient » sur une autre org
 * en basculant dessus via l'org switcher (POST /api/user/switch-org), ce qui
 * met à jour son `profiles.organization_id`.
 *
 * @returns Le profil si authentifié, null sinon.
 */
export async function requireDspAccess(req: NextRequest): Promise<UserProfile | null> {
  const authHeader = req.headers.get('authorization');
  return getUserFromRequest(authHeader);
}

/**
 * Réponse 401 standardisée pour les routes nécessitant une authentification.
 */
export function authUnauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Authentification requise.' },
    { status: 401 }
  );
}

/**
 * Réponse 403 standardisée pour les routes admin.
 * À retourner immédiatement si requireAdmin() renvoie null.
 */
export function adminUnauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Accès réservé aux administrateurs. Authentifiez-vous.' },
    { status: 403 }
  );
}
