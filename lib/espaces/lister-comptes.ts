/**
 * lib/espaces/lister-comptes.ts
 * Tous les comptes, avec TOUS leurs espaces : la vue « Tous les comptes » de
 * la page Accès (2026-10-10). C'est la seule vue qui atteint un compte
 * rattaché à aucun espace (super_admin créé sans espace, membre retiré de son
 * dernier espace) : l'onglet Membres d'un espace ne le montre jamais.
 *
 * Trois lectures quel que soit le nombre de comptes (espaces, profils,
 * appartenances), jamais plus de 3 simultanées. Profils et appartenances sont
 * lus PAGE PAR PAGE (`lireTout`) : PostgREST plafonne toute requête de table à
 * 1 000 lignes (`db-max-rows`) sans le dire, et cette liste n'a pas de borne
 * par construction. Au-delà des plafonds ci-dessous, la lecture échoue au lieu
 * de rendre une liste amputée.
 */
import type { createAdminClient } from '@/lib/auth';
import { lireTout } from '@/lib/supabase/lire-tout';
import { lireEspacesBruts } from './lister-espaces';
import { nomAffiche } from './nom-espace';
import type { CompteResume, ProprietaireJeu, RoleEspace } from './types';

type Sb = ReturnType<typeof createAdminClient>;

/** Au-delà, la lecture échoue : 10 000 comptes, c'est cent fois l'effectif connu (4 au 2026-10-10). */
const PLAFOND_COMPTES = 10_000;
/** Au-delà, la lecture échoue : en moyenne cinq espaces par compte au plafond des comptes. */
const PLAFOND_APPARTENANCES = 50_000;

interface ProfilBrut {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  organization_id: string | null;
  created_at: string | null;
}

interface AppartenanceBrute { user_id: string; organization_id: string }

export async function listerComptes(sb: Sb): Promise<CompteResume[]> {
  // Tri par clé unique (`id`) : une pagination sur un tri instable peut sauter ou doubler une ligne.
  const [espaces, profils, appartenances] = await Promise.all([
    lireEspacesBruts(sb),
    lireTout<ProfilBrut>(
      (de, a) => sb.from('profiles').select('id, email, full_name, role, organization_id, created_at').order('id').range(de, a),
      PLAFOND_COMPTES,
    ),
    lireTout<AppartenanceBrute>(
      (de, a) => sb.from('organization_members').select('user_id, organization_id').order('id').range(de, a),
      PLAFOND_APPARTENANCES,
    ),
  ]);

  const noms = new Map(espaces.map((e) => [e.id, nomAffiche(e)]));
  const parCompte = new Map<string, ProprietaireJeu[]>();
  for (const m of appartenances.lignes) {
    const liste = parCompte.get(m.user_id) ?? [];
    liste.push({ id: m.organization_id, nom_affiche: noms.get(m.organization_id) ?? 'Espace supprimé' });
    parCompte.set(m.user_id, liste);
  }

  return profils.lignes.map((p): CompteResume => ({
    id: p.id,
    email: p.email,
    nom: p.full_name,
    role: p.role as RoleEspace,
    espace_actif: p.organization_id,
    espaces: (parCompte.get(p.id) ?? []).sort((a, b) => a.nom_affiche.localeCompare(b.nom_affiche, 'fr')),
    cree_le: p.created_at,
  })).sort((a, b) => a.email.localeCompare(b.email, 'fr'));
}
