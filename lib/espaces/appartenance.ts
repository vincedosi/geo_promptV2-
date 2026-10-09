/**
 * lib/espaces/appartenance.ts
 * Écrire l'appartenance d'un utilisateur à un espace de travail.
 *
 * `organization_members` est la source de vérité de l'appartenance ;
 * `profiles.organization_id` n'est que l'espace ACTIF. sql/236 tient
 * l'invariant en base (l'actif d'un non-super_admin est un de ses espaces) et
 * reporte l'actif quand on retire quelqu'un : ce module n'a donc PAS à le
 * recalculer — il écrit l'appartenance, et pose l'actif seulement s'il était vide.
 *
 * Jusqu'au 2026-10-09, « ajouter un membre » n'écrivait QUE l'actif : aucun
 * code n'écrivait organization_members.
 */
import type { createAdminClient } from '@/lib/auth';
import type { UserRole } from '@/types/admin';

type Sb = ReturnType<typeof createAdminClient>;

export type ResultatEcriture = { ok: true } | { ok: false; status: number; message: string };

/**
 * Traduit une erreur de base en réponse lisible. Les codes que sql/236 lève
 * exprès ont un message français ; le reste remonte tel quel en 500.
 */
export function messageErreurAppartenance(code: string | undefined, message: string): { status: number; message: string } {
  if (code === '23514') return { status: 400, message: 'Cet utilisateur n\'est pas membre de cet espace.' };
  if (code === '22023') return { status: 400, message: 'L\'espace actif doit faire partie des espaces de l\'utilisateur.' };
  if (code === '23503') return { status: 400, message: 'Espace introuvable.' };
  if (code === 'P0002') return { status: 404, message: 'Utilisateur introuvable.' };
  return { status: 500, message };
}

/**
 * Rend `userId` membre de `orgId`. Idempotent. Pose l'espace actif s'il était
 * vide ; n'écrit le rôle que s'il est FOURNI et que la cible n'est pas
 * super_admin — ajouter un super_admin à un espace ne doit pas le rétrograder (E3).
 */
export async function ajouterMembre(sb: Sb, orgId: string, userId: string, role?: UserRole): Promise<ResultatEcriture> {
  const { error: errMembre } = await sb
    .from('organization_members')
    .upsert({ user_id: userId, organization_id: orgId }, { onConflict: 'user_id,organization_id', ignoreDuplicates: true })
    .select('id');
  if (errMembre) return { ok: false, ...messageErreurAppartenance(errMembre.code, errMembre.message) };

  const { data: profil, error: errLecture } = await sb.from('profiles').select('organization_id, role').eq('id', userId).maybeSingle();
  if (errLecture) return { ok: false, ...messageErreurAppartenance(errLecture.code, errLecture.message) };
  if (!profil) return { ok: false, status: 404, message: 'Utilisateur introuvable.' };

  const maj: { organization_id?: string; role?: UserRole } = {};
  if (profil.organization_id === null) maj.organization_id = orgId;
  // E3 : un super_admin n'est jamais rétrogradé par un ajout d'espace, même si
  // l'appelant (l'écran React envoie toujours un rôle) en fournit un. Changer
  // le rôle d'un super_admin passe par PATCH /api/admin/users/[id].
  if (role !== undefined && profil.role !== 'super_admin') maj.role = role;
  if (Object.keys(maj).length === 0) return { ok: true };

  const { error } = await sb.from('profiles').update(maj).eq('id', userId);
  if (error) return { ok: false, ...messageErreurAppartenance(error.code, error.message) };
  return { ok: true };
}

/**
 * Retire `userId` de `orgId`. Le report de l'espace actif est fait par sql/236.
 * Ne touche pas au rôle (E3).
 */
export async function retirerMembre(sb: Sb, orgId: string, userId: string): Promise<ResultatEcriture> {
  const { error, count } = await sb
    .from('organization_members')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('organization_id', orgId);
  if (error) return { ok: false, ...messageErreurAppartenance(error.code, error.message) };
  if (!count) return { ok: false, status: 404, message: 'Cet utilisateur n\'est pas membre de cet espace.' };
  return { ok: true };
}

/**
 * Remplace la liste des espaces d'un utilisateur et son espace actif, en UNE
 * transaction (RPC sql/236) : la fiche utilisateur coche plusieurs cases d'un
 * coup, et une suite d'appels séparés pourrait s'arrêter au milieu.
 */
export async function remplacerEspaces(
  sb: Sb, userId: string, espaces: string[], espaceActif: string | null,
): Promise<{ ok: true; espaces: string[]; espace_actif: string | null } | { ok: false; status: number; message: string }> {
  const { data, error } = await sb.rpc('remplacer_espaces_utilisateur', {
    // Le générateur de types ne rend jamais un paramètre nullable (`p_actif`
    // vaut `string`) ; la RPC accepte bien null (« aucun espace actif »).
    p_user: userId, p_espaces: espaces, p_actif: espaceActif as string,
  });
  if (error) return { ok: false, ...messageErreurAppartenance(error.code, error.message) };
  const r = data as { espaces: string[]; espace_actif: string | null };
  return { ok: true, espaces: [...r.espaces].sort(), espace_actif: r.espace_actif };
}
