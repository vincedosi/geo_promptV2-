/**
 * Campagnes multi-média et panneaux OOH d'une campagne — types du modèle d'import
 * (spec docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md).
 *
 * Préfixés pour ne pas se confondre avec `dsp_campaigns` (achat digital) et `CampagnePlan` (rattachement d'un plan
 * média de zones) : voir ARCHITECTURE « Campagnes multi-média ».
 */

/** Le média d'une ligne — la contrainte CHECK de `campagne_lignes.media` (sql/261). */
type MediaLigne = 'digital' | 'ooh' | 'tv' | 'radio' | 'presse';

/** Comment un emplacement a été placé — CHECK `panneaux_geoloc_methode_check` (sql/262). */
type GeolocMethode = 'referentiel_gares' | 'adresse_ban' | 'alias_manuel' | 'coordonnees_fournies';

/** `sure`, ou `a_verifier` : un emplacement incertain est marqué, jamais placé en silence (sql/262). */
export type GeolocQualite = 'sure' | 'a_verifier';

/** Une cellule lue : scalaire, date ISO `yyyy-mm-dd`, ou vide (`null`). */
export type Cellule = string | number | boolean | null;

/** Une ligne de feuille : son numéro Excel (1 = première) et ses cellules, index 0 = colonne A. */
export interface LigneFeuille {
  numero: number;
  cellules: Cellule[];
}

export interface Feuille {
  nom: string;
  lignes: LigneFeuille[];
}

/** Un classeur lu (`lireClasseur`) : ses feuilles par nom exact, dans l'ordre du fichier. */
export interface Classeur {
  feuilles: Map<string, Feuille>;
}

/** Un coût du plan qui n'est pas un réseau (« IMPRESSION JUSQU'À 5 VISUELS »). */
export interface CoutAnnexe {
  libelle: string;
  frais: number | null;
  honoraires: number | null;
  total_ttc: number | null;
}

/** L'en-tête de campagne lu dans l'onglet de synthèse. */
export interface EnteteCampagne {
  titre: string | null;
  hypothese: string | null;
  date_debut: string | null;
  date_fin: string | null;
  budget_total_ttc: number | null;
  couts_annexes: CoutAnnexe[];
  notes: string[];
}

/** Une ligne de campagne telle que le plan la donne, avant écriture (colonnes de `campagne_lignes`). */
export interface LignePlan {
  ordre: number;
  media: MediaLigne;
  regie: string;
  reseau: string | null;
  territoire: string | null;
  nb_ecrans: number | null;
  format: string | null;
  nb_diffusions: number | null;
  date_debut: string | null;
  date_fin: string | null;
  duree_libelle: string | null;
  rang_option: string | null;
  plage_horaire: string | null;
  montant_brut: number | null;
  montant_net: number | null;
  frais: number | null;
  honoraires: number | null;
  total_ttc: number | null;
  contacts_15_plus: number | null;
  contacts_18_24: number | null;
  /** Toute la ligne d'origine (onglet, numéro, cellules), la section du plan, le nombre de lieux annoncé. */
  details: Record<string, unknown>;
}

/** Les formats de régie qu'un adaptateur sait lire. */
export type AdaptateurId = 'synthese-hyp' | 'mediatransports-gares' | 'basic-fit' | 'stride-campus';

/** Bloc d'une liste de gares : Île-de-France, province, ou non dit. */
export type BlocGares = 'idf' | 'province' | 'inconnu';

/** Ce que le géolocalisateur doit chercher. */
type RechercheEmplacement =
  | { type: 'gare'; nom: string; bloc: BlocGares }
  | { type: 'adresse'; adresse: string; code_postal: string | null; ville: string | null; commune_seule: boolean };

/** Une ligne d'origine gardée dans `metadata.lignes`. */
interface LigneOrigine {
  numero: number;
  cellules: Record<string, Cellule>;
  [cle: string]: unknown;
}

/** `panneaux_affichage.metadata` : l'onglet, les lignes d'origine EN ENTIER, et ce que l'adaptateur en a tiré. */
interface MetadataEmplacement {
  onglet: string;
  lignes: LigneOrigine[];
  [cle: string]: unknown;
}

/** Un emplacement lu dans la liste d'une régie, pas encore placé. */
export interface EmplacementBrut {
  adaptateur: AdaptateurId;
  /** Identité dans le réseau avant géolocalisation (code club, établissement + CP, nom de gare normalisé). */
  cle: string;
  nom_lieu: string;
  type_lieu: string;
  reseau: string;
  numerique: boolean;
  nb_ecrans: number | null;
  formats: string[];
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  reference_panneau: string | null;
  contacts_semaine: number | null;
  contacts_18_25_semaine: number | null;
  recherche: RechercheEmplacement;
  metadata: MetadataEmplacement;
}

/** Un emplacement placé : `source_ref` définitif (UIC d'une gare, code club…) et sa géolocalisation. */
export interface EmplacementPlace extends EmplacementBrut {
  source_ref: string;
  lat: number;
  lng: number;
  code_insee: string | null;
  code_departement: string | null;
  geoloc_methode: GeolocMethode;
  geoloc_qualite: GeolocQualite;
  geoloc_score: number;
  geoloc_libelle: string;
  /** Pourquoi un point est « à vérifier » (score, commune seule, ville ou CP différents…) — pour le rapport seulement. */
  geoloc_raison?: string;
}

/** Un emplacement introuvable : il n'entre pas dans la table, il est compté sur sa ligne et listé au rapport. */
export interface EmplacementNonPlace {
  adaptateur: AdaptateurId;
  cle: string;
  nom: string;
  raison: string;
  metadata: MetadataEmplacement;
}

/** Ce qu'un adaptateur tire d'un classeur. La synthèse rend l'en-tête et les lignes ; une liste, des emplacements. */
export interface LecturePlan {
  entete: EnteteCampagne | null;
  lignes: LignePlan[];
  emplacements: EmplacementBrut[];
}

/** Un format de régie. La vague suivante = un adaptateur de plus, ou aucun si le format est le même (spec § 7). */
export interface AdaptateurPlan {
  id: AdaptateurId;
  /** Régies (normalisées par `normaliser`) dont ce format porte les emplacements ; vide pour la synthèse. */
  regies: readonly string[];
  reconnait(classeur: Classeur): boolean;
  lire(classeur: Classeur): LecturePlan;
}
