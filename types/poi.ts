/**
 * GENESIS — Canonical POI types
 *
 * Source unique de vérité pour les interfaces POI et PoiRow.
 * À importer depuis tout fichier ayant besoin de ces types.
 */

/**
 * Point d'Intérêt — entité complète (depuis Supabase ou enrichie)
 */
export interface POI {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  categorie: string;
  sous_categorie?: string;
  adresse?: string;
  ville?: string;
  region?: string;
  departement?: string;
  code_departement?: string;
  code_postal?: string;
  date_import?: string;
  organization_id?: string;
  data_source_id?: string;
  metadata?: unknown;
}

/**
 * Ligne POI minimale retournée par les requêtes Supabase et ORS
 * (sous-ensemble de POI, sans les champs optionnels lourds)
 */
export type PoiRow = Pick<POI,
  'id' | 'nom' | 'lat' | 'lng' | 'categorie' |
  'sous_categorie' | 'adresse' | 'ville'
>;
