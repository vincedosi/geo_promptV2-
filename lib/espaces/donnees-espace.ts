/**
 * lib/espaces/donnees-espace.ts
 * Les jeux de données, et le statut de chacun POUR un espace (spec § 4.4).
 *
 * `statutPourEspace` est la condition de `getOrgSourceIds` (et de sa jumelle
 * SQL `source_visible`, sql/234) relue jeu par jeu : un jeu est visible de
 * l'espace SI ET SEULEMENT SI son statut n'est pas `non_visible`.
 * tests/integration/espaces-lectures.test.ts vérifie cette équivalence
 * contre `getOrgSourceIds` pour chaque espace de la base : si les deux
 * divergeaient, l'écran mentirait sur les droits.
 *
 * Lectures bornées par construction : sources, organisations et appartenances
 * se comptent en dizaines (5 sources, 4 espaces le 2026-10-09), loin du
 * plafond serveur de 1 000 lignes (PostgREST db-max-rows). Aucune RPC
 * tabulaire : pas de troncature PostgREST possible.
 */
import type { createAdminClient } from '@/lib/auth';
import { nomAffiche } from './nom-espace';
import { FILTRE_SOURCE_NON_SUPPRIMEE } from '@/lib/auth/getOrgSourceIds';
import type {
  JeuDeDonnees, JeuPourEspace, ProprietaireJeu, ReponseDonneesEspace, ReponseSocle, StatutJeu, TypeJeu, Visibilite,
} from './types';
import { resumerEspace, lireEspacesBruts } from './lister-espaces';

type Sb = ReturnType<typeof createAdminClient>;

const ORDRE: Record<StatutJeu, number> = { proprietaire: 0, partage: 1, socle: 2, non_visible: 3 };

export function statutPourEspace(
  jeu: { visibilite: Visibilite; organization_id: string | null; shared_with: string[] },
  orgId: string,
): StatutJeu {
  if (jeu.visibilite === 'socle') return 'socle';
  if (jeu.organization_id === orgId) return 'proprietaire';
  if (jeu.shared_with.includes(orgId)) return 'partage';
  return 'non_visible';
}

interface SourceBrute {
  id: string; name: string; type: string; category: string | null; valid_count: number | null;
  visibilite: string; organization_id: string | null; shared_with: string[] | null;
}

/**
 * Toutes les sources non supprimées, avec leur propriétaire et leurs partages nommés.
 * Bornée : une ligne par source (dizaines), sous le plafond serveur de 1 000.
 */
export async function lireJeux(sb: Sb): Promise<Array<JeuDeDonnees & { organization_id: string | null; shared_with: string[] }>> {
  const [{ data: sources, error }, espaces] = await Promise.all([
    sb.from('data_sources')
      .select('id, name, type, category, valid_count, visibilite, organization_id, shared_with')
      .or(FILTRE_SOURCE_NON_SUPPRIMEE)
      .order('name'),
    lireEspacesBruts(sb),
  ]);
  if (error) throw new Error(`lecture des sources : ${error.message}`);
  const nommer = (id: string): ProprietaireJeu => {
    const o = espaces.find((e) => e.id === id);
    return { id, nom_affiche: o ? nomAffiche(o) : 'Espace supprimé' };
  };
  return ((sources ?? []) as unknown as SourceBrute[]).map((s) => ({
    id: s.id,
    nom: s.name,
    type: s.type as TypeJeu,
    categorie: s.category,
    nb_lignes: s.valid_count ?? 0,
    visibilite: (s.visibilite === 'socle' ? 'socle' : 'privee') as Visibilite,
    proprietaire: s.organization_id ? nommer(s.organization_id) : null,
    partage_avec: (s.shared_with ?? []).map(nommer),
    organization_id: s.organization_id,
    shared_with: s.shared_with ?? [],
  }));
}

export function sansCles<T extends { organization_id: unknown; shared_with: unknown }>(j: T): Omit<T, 'organization_id' | 'shared_with'> {
  const { organization_id: _o, shared_with: _s, ...reste } = j;
  return reste;
}

export async function donneesDeLEspace(sb: Sb, orgId: string): Promise<ReponseDonneesEspace | null> {
  const espace = await resumerEspace(sb, orgId);
  if (!espace) return null;
  const jeux: JeuPourEspace[] = (await lireJeux(sb))
    .map((j) => ({ ...sansCles(j), statut: statutPourEspace(j, orgId) }))
    .sort((x, y) => ORDRE[x.statut] - ORDRE[y.statut] || x.nom.localeCompare(y.nom, 'fr'));
  return { espace, jeux };
}

export async function lireSocle(sb: Sb): Promise<ReponseSocle> {
  // Au plus 3 requêtes simultanées : lireJeux en lance 2, lireEspacesBruts 1.
  const [jeux, espaces] = await Promise.all([lireJeux(sb), lireEspacesBruts(sb)]);
  return {
    jeux: jeux.map(sansCles).sort((x, y) =>
      (x.visibilite === 'socle' ? 0 : 1) - (y.visibilite === 'socle' ? 0 : 1) || x.nom.localeCompare(y.nom, 'fr')),
    nb_espaces_clients: espaces.filter((e) => !e.interne).length,
  };
}
