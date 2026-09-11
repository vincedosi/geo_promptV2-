/**
 * lib/auth/getOrgSourceIds.ts
 * Helper partagé : retourne les IDs de sources autorisées pour une session.
 *
 * null = pas de filtre (super_admin ou dev sans session)
 * []   = org configurée mais aucune source → aucun POI accessible
 * [...] = filtre .in('data_source_id', ids)
 */
import { createAdminClient } from '@/lib/auth';
import type { SessionOrg } from '@/lib/auth/getSessionOrg';

export async function getOrgSourceIds(
  session: SessionOrg | null,
): Promise<string[] | null> {
  if (!session || session.role === 'super_admin') return null;
  if (!session.orgId) return null; // pas de session → pas de filtre (dev bypass)

  // `SEC-002` — `.or()` de postgrest-js prend une CHAINE de filtre : c'est son
  // API, il n'existe pas de forme parametree. On ne peut donc pas eviter
  // l'interpolation ; on peut en revanche garantir que ce qu'on interpole est
  // bien un UUID.
  //
  // `session.orgId` vient de `profiles.organization_id`, une valeur serveur et
  // non une entree utilisateur : le risque est theorique aujourd'hui. Cette
  // garde existe pour le jour ou la provenance de la valeur changerait — et ce
  // jour-la, personne ne repensera a relire cette ligne.
  //
  // En cas de valeur inattendue on renvoie `[]` et NON `null` : `[]` ferme
  // l'acces, `null` l'ouvrirait en grand. Se tromper de cote ici transformerait
  // une anomalie en fuite de donnees.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.orgId)) {
    return [];
  }

  const supabase = createAdminClient();
  const { data: sources } = await supabase
    .from('data_sources')
    .select('id')
    .neq('status', 'deleted')
    .or(`organization_id.eq.${session.orgId},shared_with.cs.{${session.orgId}}`);

  return sources?.map((s: { id: string }) => s.id) ?? [];
}
