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
 * Réponse 403 standardisée pour les routes admin.
 * À retourner immédiatement si requireAdmin() renvoie null.
 */
export function adminUnauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Accès réservé aux administrateurs. Authentifiez-vous.' },
    { status: 403 }
  );
}
