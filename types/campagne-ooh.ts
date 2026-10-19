/**
 * La lecture d'une campagne OOH telle que la rend `campagne_ooh_jsonb` (sql/263), côté serveur Next.
 *
 * Ne déclare que les champs qu'un consommateur serveur lit (l'export HTML, `lib/ooh/export-html.ts`) ; la forme
 * complète, avec `metadata` et toutes les colonnes d'emplacement, est décrite côté Angular dans
 * `angular/src/app/features/carte/logique/campagnes-ooh.ts` (`DetailCampagneOoh`). Les champs omis ici existent dans
 * la réponse : ils ne sont simplement pas lus.
 */
import type { CoutAnnexe, GeolocQualite } from '@/types/campagnes-media';

/** Un emplacement de la liste de la régie que l'import n'a pas pu placer (`campagne_lignes.details.non_places`). */
interface NonPlaceOoh {
  nom: string;
  raison: string;
}

/** Un coût hors ligne média du plan (`campagnes.metadata.couts_annexes`, écrit par l'import : `CoutAnnexe`). */
type CoutAnnexeOoh = Pick<CoutAnnexe, 'libelle' | 'total_ttc'>;

export interface LigneOohLue {
  id: string;
  ordre: number;
  regie: string | null;
  reseau: string | null;
  territoire: string | null;
  nb_ecrans: number | null;
  format: string | null;
  date_debut: string | null;
  date_fin: string | null;
  duree_libelle: string | null;
  total_ttc: number | null;
  contacts_15_plus: number | null;
  contacts_18_24: number | null;
  details: { non_places?: NonPlaceOoh[]; nb_lieux_plan?: number; unite_lieux_plan?: string; [cle: string]: unknown } | null;
  /** Faux : la régie n'a fourni aucune liste d'emplacements (les DROM de TF4). */
  a_des_emplacements: boolean;
  nb_places: number;
  nb_a_verifier: number;
  nb_non_places: number;
}

export interface EmplacementOohLu {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    ligne_id: string;
    nom_lieu: string | null;
    adresse: string | null;
    ville: string | null;
    code_postal: string | null;
    regie: string | null;
    reseau: string | null;
    type_lieu: string | null;
    nb_ecrans: number | null;
    formats: string[] | null;
    geoloc_qualite: GeolocQualite | null;
    geoloc_libelle: string | null;
  };
}

export interface CampagneOohLue {
  campagne: {
    id: string;
    nom: string;
    annonceur: string | null;
    vague: string | null;
    date_debut: string | null;
    date_fin: string | null;
    budget_total_ttc: number | null;
    /**
     * `campagnes.metadata` ; seuls les coûts ANNEXES (hors lignes média : impression…) y sont lus. Ce sont eux qui
     * font le pont entre la somme des lignes et `budget_total_ttc` (TF4 : 229 698,90 € + 19 975,20 € d'impression).
     */
    metadata?: { couts_annexes?: CoutAnnexeOoh[] | null; [cle: string]: unknown } | null;
  };
  lignes: LigneOohLue[];
  emplacements: EmplacementOohLu[];
  tronque: boolean;
}
