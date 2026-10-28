/**
 * lib/espaces/types.ts
 * Formes des réponses de la page « Espaces de travail ». Copiées dans
 * angular/src/app/features/admin/espaces/logique/types.ts, parité par
 * assignabilité mutuelle : tests/unit/angular/espaces-types-paritaires.test.ts.
 */
/** `indicateur` : un indicateur privable (sql/288), même règles et mêmes gestes d'Accès qu'un jeu importé. */
export type TypeJeu = 'poi' | 'panneaux' | 'carreaux' | 'indicateur';
export type Visibilite = 'socle' | 'privee';
/** Statut d'un jeu POUR un espace donné (spec § 4.4), dans l'ordre de tri. */
export type StatutJeu = 'proprietaire' | 'partage' | 'socle' | 'non_visible';
export type RoleEspace = 'super_admin' | 'admin' | 'client';

export interface EspaceResume {
  id: string;
  nom: string;            // organizations.name, tel qu'en base
  nom_affiche: string;    // E2 : « dentsu.explore (interne) » pour genesis-global
  slug: string;
  actif: boolean;
  interne: boolean;       // slug === 'genesis-global'
  nb_membres: number;     // appartenances (organization_members)
  nb_jeux_prives: number; // sources privées possédées, non supprimées
}

export interface ReponseEspaces {
  socle: { nb_jeux: number };
  espaces: EspaceResume[];   // tri : nom_affiche, internes en dernier
  nb_comptes: number;        // tous les profils : compteur de « Tous les comptes »
}

export interface ProprietaireJeu { id: string; nom_affiche: string }

export interface JeuDeDonnees {
  id: string;
  nom: string;
  type: TypeJeu;
  categorie: string | null;
  nb_lignes: number;         // data_sources.valid_count (jamais un COUNT)
  visibilite: Visibilite;
  proprietaire: ProprietaireJeu | null;
  partage_avec: ProprietaireJeu[];
}

export interface JeuPourEspace extends JeuDeDonnees { statut: StatutJeu }

export interface ReponseDonneesEspace {
  espace: EspaceResume;
  jeux: JeuPourEspace[];     // tri : statut (ordre de StatutJeu), puis nom
}

/** « Socle » : tous les jeux, sans statut (fiche Socle, spec § 4.2). */
export interface ReponseSocle {
  jeux: JeuDeDonnees[];      // tri : socle d'abord, puis nom
  nb_espaces_clients: number; // espaces non internes : « combien le perdent »
}

export interface MembreEspace {
  id: string;
  email: string;
  nom: string | null;
  role: RoleEspace;
  espace_actif: string | null;
  autres_espaces: ProprietaireJeu[]; // ses AUTRES espaces (pastilles)
}

/** Un compte de la vue « Tous les comptes » de la page Accès (2026-10-10). */
export interface CompteResume {
  id: string;
  email: string;
  nom: string | null;
  role: RoleEspace;
  espace_actif: string | null;
  espaces: ProprietaireJeu[]; // TOUS ses espaces, tri : nom_affiche
  cree_le: string | null;     // profiles.created_at (ISO), colonne nullable
}

export interface ReponseComptes {
  comptes: CompteResume[];    // tri : email
}

export interface ApercuEspace {
  jeux: { socle: JeuDeDonnees[]; proprietaire: JeuDeDonnees[]; partage: JeuDeDonnees[] };
  categories: string[];      // catégories POI visibles, SANS effectif (E4)
  nb_campagnes: number;
}
