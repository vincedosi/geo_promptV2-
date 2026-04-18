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
  deleted: number;
  errors: number;
  duration_ms: number;
}
