import type { PacingItemInput, PacingStatus } from '@/lib/pacing/compute';

/** Entête de snapshot dédupliquée par version (colonnes répétées sur chaque ligne). */
export interface SnapshotMeta {
  version: number;
  budget: number;
  cpm: number;
  cible: string;
  dsp: string;
  zone_name: string;
  period_start: string | null;
  period_end: string | null;
}

/** Pacing brut d'une version, tel que renvoyé par get_campaign_pacing (avant computePacing). */
export interface RawVersionPacing {
  version: number;
  items: PacingItemInput[];
  in_plan_imp: number;
  total_imp: number;
  spillover_imp: number;
}

export interface ReportHeader {
  campaign_id: string;
  campaign_name: string;
  zone_name: string;
  dsp: string;
  cible: string;
  period_start: string;
  period_end: string;
  version_count: number;
}

export interface ConvergencePoint {
  version: number;
  mean_delta: number;   // moyenne |delta_pts|, 2 décimales
  converged: boolean;   // mean_delta < CONVERGENCE_TOLERANCE
}

export interface ZoneBeforeAfter {
  item_id: string;
  item_name: string;
  expected_share: number;     // cible fixe [0,1]
  actual_share_first: number; // v1 [0,1]
  actual_share_last: number;  // dernière version [0,1]
  delta_first: number;        // points, 1 décimale
  delta_last: number;         // points, 1 décimale
  status_first: PacingStatus;
  status_last: PacingStatus;
}

export interface BudgetSummary {
  planned_total: number;
  spent_total: number;
  variance_pct: number;
  planned_last: number;
  spent_last: number;
  variance_last_pct: number;
  in_plan_imp_total: number;
  total_imp_total: number;
  spillover_imp_total: number;
  spillover_pct: number;
}

export interface ReportKpis {
  corrections: number;
  delta_first: number;
  delta_last: number;
  improvement_pts: number;
  converged: boolean;
  conforming_items_last: number;
  total_items: number;
}

export interface CampaignReport {
  header: ReportHeader;
  convergence: ConvergencePoint[];
  zones: ZoneBeforeAfter[];
  budget: BudgetSummary;
  kpis: ReportKpis;
}
