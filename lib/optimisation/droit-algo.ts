/**
 * @file lib/optimisation/droit-algo.ts — qui lit et qui règle l'algorithme de correction d'une campagne (tâche 2.7).
 *
 * Plan § 16.2 : « celui qui règle la campagne » choisit l'algorithme ; Next vérifie le droit, Python le choix.
 *
 * - LIRE : quiconque accède à la campagne (`resolveCampaignAccess`, `lib/campaigns/access.ts`) — super_admin,
 *   espace propriétaire, espace avec qui elle est partagée. Sinon : introuvable (404, jamais 403 : on ne révèle pas
 *   qu'une campagne d'un autre espace existe — même règle que toutes les routes de campagne).
 * - RÉGLER : super_admin, ou tout membre (admin ou client) de l'espace PROPRIÉTAIRE — les mêmes qui règlent la
 *   stratégie de la campagne. Un espace avec qui la campagne est seulement PARTAGÉE la lit sans la régler (403) :
 *   l'algorithme change ce que paient les régies du propriétaire.
 * - L'espace transmis au service (`X-Espace`) est TOUJOURS l'espace propriétaire, que le service revérifie
 *   (`dsp_campaigns.organization_id`), même quand c'est un super_admin d'un autre espace qui agit.
 *
 * Rôles : `RoleSchema` (`lib/auth/roles.ts`, source unique) — un rôle hors du modèle n'ouvre rien.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { RoleSchema } from '@/lib/auth/roles';
import { resolveCampaignAccess } from '@/lib/campaigns/access';
import type { UserRole } from '@/types/admin';

export type DroitAlgo =
  | { acces: 'introuvable' }
  | { acces: 'lecture' | 'reglage'; espace: string; role: UserRole };

/** Décision pure, testable sans base. */
export function resoudreDroitAlgo(
  role: string,
  orgUtilisateur: string | null,
  orgProprietaire: string | null,
  orgsLiees: string[],
): DroitAlgo {
  const r = RoleSchema.safeParse(role);
  if (!r.success || orgProprietaire === null) return { acces: 'introuvable' };
  if (!resolveCampaignAccess(r.data, orgUtilisateur, orgProprietaire, orgsLiees)) return { acces: 'introuvable' };
  const regle = r.data === 'super_admin' || orgUtilisateur === orgProprietaire;
  return { acces: regle ? 'reglage' : 'lecture', espace: orgProprietaire, role: r.data };
}

/**
 * Le droit en base : deux lectures indexées (clé primaire de la campagne, pivot par `campaign_id`), comme
 * `checkCampaignAccess`, mais en gardant l'espace propriétaire qu'il faut transmettre au service.
 */
export async function lireDroitAlgo(
  supabase: SupabaseClient,
  profil: { role: string; organization_id: string | null },
  campagne: string,
): Promise<DroitAlgo> {
  const [camp, liens] = await Promise.all([
    supabase.from('dsp_campaigns').select('organization_id').eq('id', campagne).maybeSingle(),
    supabase.from('campaign_organizations').select('organization_id').eq('campaign_id', campagne),
  ]);
  if (camp.error) throw new Error(`Lecture de la campagne impossible : ${camp.error.message}`);
  if (liens.error) throw new Error(`Lecture des partages de la campagne impossible : ${liens.error.message}`);
  if (!camp.data) return { acces: 'introuvable' };
  const proprietaire = (camp.data as { organization_id: string | null }).organization_id;
  const liees = ((liens.data ?? []) as Array<{ organization_id: string }>).map((l) => l.organization_id);
  return resoudreDroitAlgo(profil.role, profil.organization_id, proprietaire, liees);
}
