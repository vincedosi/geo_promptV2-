/**
 * lib/chat/tools/types.ts
 * Interfaces partagées entre tous les outils IA.
 */

export interface PoiResult {
  id:              string;
  nom:             string;
  lat:             number;
  lng:             number;
  categorie:       string;
  sous_categorie?: string | null;
  adresse?:        string;
  ville?:          string;
  rank?:           number;
  audience?:       number;
}

export interface BillboardRaw {
  id:           string;
  source_ref?:  string;
  regie?:       string;
  type_panneau?: string;
  lat:          number | string;
  lng:          number | string;
  ville?:       string;
  adresse?:     string;
}

export interface CarreauRow {
  cx:          number | string;
  cy:          number | string;
  val_cible?:  number | string | null;
  pop_totale?: number | string | null;
}

export interface VoronoiFeature {
  properties?: {
    id?:        string;
    nom?:       string;
    lat?:       number;
    lng?:       number;
    categorie?: string;
    adresse?:   string;
    ville?:     string;
  };
  [key: string]: unknown;
}
