/**
 * Radio module — shared types
 */

export interface EmetteurRadioInsert {
  sta_nm_anfr: string;
  systeme: 'FM' | 'DAB+';
  frequence_mhz: number | null;
  puissance_w: number | null;
  hauteur_m: number | null;
  exploitant: string | null;
  adresse: string | null;
  commune: string | null;
  departement: string | null;
  lat: number;
  lon: number;
  snapshot_date: string; // YYYY-MM-DD
}

export interface RadioStreamEvent {
  type: 'status' | 'progress' | 'done' | 'error';
  message: string;
  [key: string]: unknown;
}

export interface ImportStats {
  total_parsed: number;
  total_fm: number;
  total_dab: number;
  inserted: number;
  updated: number;
  /** Lignes RÉELLEMENT supprimées (`count: 'exact'`), pas la taille des lots demandés. */
  deleted: number;
  errors: number;
  /** Émetteurs dont la suppression a échoué (chaque échec est aussi journalisé). */
  delete_errors: number;
  /** Retirés de l'ANFR mais conservés : liés à au moins une radio (liaisons irremplaçables, CASCADE). */
  retained_linked: number;
  /** Vrai si le garde-fou de proportion a annulé toute la phase DELETE. */
  delete_aborted: boolean;
  duration_ms: number;
}
