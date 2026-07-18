/**
 * Réconciliation DSP ⇔ ad server — types du payload de get_campaign_reconciliation
 * (sql/111) et ton du taux de mesure. Formats réutilisés de suivi-metrics (DRY).
 */
import type { SuiviTone } from './suivi-metrics';
export { toneColor, fmtPct, fmtCpm, fmtInt } from './suivi-metrics';
export type { SuiviTone } from './suivi-metrics';

export interface ReconChannelRow {
  channel: string;
  impressions: number;
  spend: number;
  cpm: number | null;
  share_pct: number | null;
}

export interface ReconDaily {
  date: string;
  dsp_impressions: number;
  adserver_impressions: number;
  dsp_spend: number;
}

export interface ReconciliationPayload {
  has_dsp_report: boolean;
  source?: 'api' | 'simulated' | 'skipped';
  as_of?: string;
  global?: {
    dsp_impressions: number;
    adserver_impressions: number;
    measure_rate: number | null;
    gap_pct: number | null;
    dsp_spend: number;
    dsp_cpm: number | null;
  };
  by_channel?: ReconChannelRow[];
  daily?: ReconDaily[];
}

export function measureRateTone(rate: number | null): SuiviTone {
  if (rate == null) return 'warn';
  if (rate >= 95) return 'ok';
  if (rate >= 85) return 'warn';
  return 'bad';
}
