/**
 * lib/auth/getOrgSourceIds.ts
 * La règle d'AUTORISATION des données importées : quelles sources une
 * session voit-elle ?
 *
 *   null  = aucun filtre — super_admin, et LUI SEUL, HORS vue espace (la
 *           carte passe `{ vueEspace: true }` : le super_admin y voit comme
 *           son espace actif, depuis le 2026-10-12)
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

/**
 * « Source non supprimée », au sens de la base : `status IS DISTINCT FROM
 * 'deleted'` (`source_visible`, `ds_select`, sql/234). À passer à `.or()`.
 *
 * `.neq('status', 'deleted')` ne dit PAS la même chose : en SQL `NULL <> x`
 * n'est pas vrai, il écarte donc aussi un statut NULL (la colonne est
 * nullable). Plusieurs `.or()` sur une requête se combinent en ET.
 */
export const FILTRE_SOURCE_NON_SUPPRIMEE = 'status.is.null,status.neq.deleted';

/**
 * Les sources visibles d'une session.
 *
 * @param options.vueEspace - Vue de la CARTE : le super_admin voit comme son
 *   espace actif, exactement comme un client de cet espace (socle seul s'il
 *   n'en a pas). Avec cette option, la fonction ne rend JAMAIS `null`. Sans
 *   elle (administration : `lib/espaces/*`, `app/api/admin/**`, chat), le
 *   contrat historique tient : `null` pour le super_admin.
 */
export async function getOrgSourceIds(
  session: SessionOrg | null,
  options: { vueEspace?: boolean } = {},
): Promise<string[] | null> {
  // Administration : le super_admin voit tout. Carte (`vueEspace`) : il voit
  // comme son espace actif, exactement comme un client de cet espace
  // (décision de Vincent du 2026-10-12, spec droits-sur-la-carte R3/R4).
  if (session?.role === 'super_admin' && !options.vueEspace) return null;

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
    .or(FILTRE_SOURCE_NON_SUPPRIMEE)
    .or(condition);

  // Une lecture en échec ne doit pas se lire « aucun filtre » : [] ferme.
  if (error) return [];
  return sources?.map((s: { id: string }) => s.id) ?? [];
}
