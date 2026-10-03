/**
 * La forme de ce que `GET /api/zones/jeux/[id]/simulation` rend à l'écran.
 *
 * Partagée par la route (qui l'assemble), l'écran (qui la lit) et l'export
 * (qui la met en classeur) : trois lecteurs, une seule définition.
 */
import type { ParamsSimulation } from './types';

/** Une entrée telle que la rend `simulation_entrees` (sql/232). */
export interface EntreeBrute {
  code_postal: string;
  code_canonique: string;
  cluster_id: string | null;
  retenu: boolean;
  multiplicateur: number;
  pop_en_zone: number;
  pop_totale: number;
  part_en_zone: number;
  surface_km2: number | null;
  membre: boolean;
  x: number | null;
  y: number | null;
}

/** Un bassin du jeu. */
export interface ZoneSimulation {
  id: string;
  rang: number;
  nom: string;
  niveau: string | null;
  n_sites: number;
  pop_exposee: number;
  /** [ouest, sud, est, nord], pour recadrer la carte. */
  bbox: [number, number, number, number] | null;
}

interface AgregatCp { cp: string; v: 1 | 2; imps: number; utiles: number; spend: number }
interface AgregatZoneJour { jour: number; cid: string; imps: number; utiles: number; spend: number }
interface AgregatJour { jour: number; imps: number; utiles: number; spend: number; en_zone: number }
interface AgregatPartenaire {
  partenaire: string; v: 1 | 2; imps: number; spend: number; en_zone: number; utiles: number;
}

export interface Agregats {
  par_cp: AgregatCp[];
  par_zone_jour: AgregatZoneJour[];
  par_jour: AgregatJour[];
  par_partenaire: AgregatPartenaire[];
}

export interface SimulationMeta {
  id: string;
  campaign_id: string;
  statut: 'v1' | 'v2';
  date_debut: string;
  jours: number;
  jour_recalage: number;
  params: ParamsSimulation;
  lignes_v1: number;
  lignes_v2: number;
  created_at: string;
  extraction_v1: { id: string; version: number };
  extraction_v2: { id: string; version: number } | null;
}

export interface ReponseSimulation {
  simulation: SimulationMeta | null;
  entrees?: EntreeBrute[];
  /** Le multiplicateur v2 de chaque code postal, quand le recalage a eu lieu. */
  multiplicateurs_v2?: Record<string, number>;
  zones?: ZoneSimulation[];
  agregats?: Agregats;
}

/** Un événement du flux NDJSON de génération. */
export type EvenementSimulation =
  | { etape: 'preparation'; message: string }
  | { etape: 'generation'; message: string; lignes: number }
  | { etape: 'insertion'; message: string; faites: number; total: number; pourcentage: number }
  | { etape: 'termine'; message: string; simulation_id: string; lignes: number; duree_ms: number }
  | { etape: 'erreur'; message: string };
