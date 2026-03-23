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

  const supabase = createAdminClient();
  const { data: sources } = await supabase
    .from('data_sources')
    .select('id')
    .neq('status', 'deleted')
    .or(`organization_id.eq.${session.orgId},shared_with.cs.{${session.orgId}}`);

  return sources?.map((s: { id: string }) => s.id) ?? [];
}
