/**
 * lib/auth/getOrgSourceIds.ts
 * La règle d'AUTORISATION des données importées : quelles sources une
 * session voit-elle ?
 *
 *   null  = aucun filtre — super_admin, et LUI SEUL
 *   [...] = filtre `.in('data_source_id', ids)` : le socle, plus les sources
 *           de l'organisation, plus celles qu'on lui a partagées
 *   []    = rien (impossible en pratique dès qu'une source est au socle)
 *
 * ── ELLE FERME PAR DÉFAUT DEPUIS LE 2026-10-08 ─────────────────────────────
 *
 * Elle rendait `null` — « tout voir » — sans session, et pour un compte sans
 * organisation. Toute anomalie (cookie illisible, profil incomplet) ouvrait
 * donc les données de TOUS les clients. Désormais une session absente ou
 * douteuse voit le socle, et rien d'autre.
 *
 * ── TROIS NIVEAUX, LA MÊME RÈGLE QU'EN BASE ────────────────────────────────
 *
 * `data_sources.visibilite` vaut 'socle' (tout le monde) ou 'privee'
 * (l'organisation propriétaire, et celles de `shared_with`). C'est
 * EXACTEMENT la condition de `source_visible()` (sql/234), qui protège les
 * accès directs par PostgREST. Les routes passent par service_role et
 * contournent la RLS : c'est donc cette fonction-ci qui les protège. Les deux
 * doivent rester égales.
 */
import { createAdminClient } from '@/lib/auth';
import type { SessionOrg } from '@/lib/auth/getSessionOrg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getOrgSourceIds(
  session: SessionOrg | null,
): Promise<string[] | null> {
  if (session?.role === 'super_admin') return null;

  // `SEC-002` — `.or()` de postgrest-js prend une CHAINE de filtre, sans forme
  // paramétrée. On n'y interpole donc qu'un UUID vérifié. Une organisation
  // absente ou douteuse ne s'interpole pas : on retombe sur le socle seul.
  const orgId = session?.orgId && UUID.test(session.orgId) ? session.orgId : null;
  const condition = orgId
    ? `visibilite.eq.socle,organization_id.eq.${orgId},shared_with.cs.{${orgId}}`
    : 'visibilite.eq.socle';

  const supabase = createAdminClient();
  const { data: sources, error } = await supabase
    .from('data_sources')
    .select('id')
    .neq('status', 'deleted')
    .or(condition);

  // Une lecture en échec ne doit pas se lire « aucun filtre » : [] ferme.
  if (error) return [];
  return sources?.map((s: { id: string }) => s.id) ?? [];
}
