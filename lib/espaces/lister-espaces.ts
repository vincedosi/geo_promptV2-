/**
 * lib/espaces/lister-espaces.ts
 * La colonne des espaces : chaque espace avec ses compteurs, et l'entrée Socle.
 *
 * Trois lectures, quel que soit le nombre d'espaces (organisations,
 * appartenances, sources). Bornées par construction : quelques dizaines de
 * lignes chacune, sous le plafond serveur de 1 000 (PostgREST db-max-rows).
 */
import type { createAdminClient } from '@/lib/auth';
import { nomAffiche, SLUG_ORGANISATION_INTERNE } from './nom-espace';
import type { EspaceResume, MembreEspace, ReponseEspaces, RoleEspace } from './types';

type Sb = ReturnType<typeof createAdminClient>;

interface EspaceBrut { id: string; name: string; slug: string; active: boolean; interne: boolean }

/** Bornée : une ligne par organisation (dizaines), sous le plafond serveur de 1 000. */
export async function lireEspacesBruts(sb: Sb): Promise<EspaceBrut[]> {
  const { data, error } = await sb.from('organizations').select('id, name, slug, active');
  if (error) throw new Error(`lecture des espaces : ${error.message}`);
  return (data ?? []).map((o) => ({ ...o, interne: o.slug === SLUG_ORGANISATION_INTERNE }));
}

function trier(a: EspaceResume, b: EspaceResume): number {
  return Number(a.interne) - Number(b.interne) || a.nom_affiche.localeCompare(b.nom_affiche, 'fr');
}

export async function listerEspaces(sb: Sb): Promise<ReponseEspaces> {
  // 3 requêtes simultanées au plus.
  const [espaces, membres, sources] = await Promise.all([
    lireEspacesBruts(sb),
    sb.from('organization_members').select('organization_id'),
    sb.from('data_sources').select('organization_id, visibilite').neq('status', 'deleted'),
  ]);
  if (membres.error) throw new Error(`lecture des membres : ${membres.error.message}`);
  if (sources.error) throw new Error(`lecture des sources : ${sources.error.message}`);

  const nbMembres = new Map<string, number>();
  for (const m of membres.data ?? []) nbMembres.set(m.organization_id, (nbMembres.get(m.organization_id) ?? 0) + 1);
  const nbPrives = new Map<string, number>();
  let nbSocle = 0;
  for (const s of sources.data ?? []) {
    if (s.visibilite === 'socle') { nbSocle++; continue; }
    if (s.organization_id) nbPrives.set(s.organization_id, (nbPrives.get(s.organization_id) ?? 0) + 1);
  }

  return {
    socle: { nb_jeux: nbSocle },
    espaces: espaces.map((e): EspaceResume => ({
      id: e.id, nom: e.name, nom_affiche: nomAffiche(e), slug: e.slug, actif: e.active, interne: e.interne,
      nb_membres: nbMembres.get(e.id) ?? 0, nb_jeux_prives: nbPrives.get(e.id) ?? 0,
    })).sort(trier),
  };
}

/** Un espace seul, avec ses compteurs ; `null` s'il n'existe pas. */
export async function resumerEspace(sb: Sb, orgId: string): Promise<EspaceResume | null> {
  const { espaces } = await listerEspaces(sb);
  return espaces.find((e) => e.id === orgId) ?? null;
}

/**
 * Les membres d'un espace, avec leurs AUTRES espaces (spec § 4.3).
 * Appartenances : une ligne par couple (dizaines), sous le plafond serveur de 1 000.
 */
export async function membresDeLEspace(sb: Sb, orgId: string): Promise<MembreEspace[]> {
  const [espaces, appartenances] = await Promise.all([
    lireEspacesBruts(sb),
    sb.from('organization_members').select('user_id, organization_id'),
  ]);
  if (appartenances.error) throw new Error(`lecture des membres : ${appartenances.error.message}`);
  const ids = (appartenances.data ?? []).filter((m) => m.organization_id === orgId).map((m) => m.user_id);
  if (ids.length === 0) return [];
  const { data: profils, error } = await sb.from('profiles')
    .select('id, email, full_name, role, organization_id').in('id', ids);
  if (error) throw new Error(`lecture des profils : ${error.message}`);
  const nom = (id: string) => {
    const e = espaces.find((x) => x.id === id);
    return { id, nom_affiche: e ? nomAffiche(e) : 'Espace supprimé' };
  };
  return (profils ?? []).map((p): MembreEspace => ({
    id: p.id, email: p.email, nom: p.full_name, role: p.role as RoleEspace, espace_actif: p.organization_id,
    autres_espaces: (appartenances.data ?? [])
      .filter((m) => m.user_id === p.id && m.organization_id !== orgId)
      .map((m) => nom(m.organization_id)),
  })).sort((a, b) => a.email.localeCompare(b.email, 'fr'));
}
