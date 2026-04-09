/**
 * GENESIS — DSP Campaign types
 */

/* ── Database row types ──────────────────────── */

export interface DspCampaign {
  id: string;
  name: string;
  dsp_source: string;
  advertiser: string | null;
  date_start: string | null;
  date_end: string | null;
  total_tracked_ads: number;
  countries: string[] | null;
  created_at: string;
  created_by: string | null;
}

export interface DspCampaignData {
  id: string;
  campaign_id: string;
  date: string;
  city: string | null;
  country: string;
  postal_code: string | null;
  region: string | null;
  dma_region: string | null;
  tracked_ads: number;
  code_iris: string | null;
  code_commune: string | null;
  matched_at: string | null;
}

/* ── API response types ──────────────────────── */

export interface CampaignListItem extends DspCampaign {
  total_rows: number;
  france_rows: number;
  matched_iris: number;
}

export interface CampaignDetail {
  campaign: DspCampaign;
  stats: {
    by_country: { country: string; tracked_ads: number; row_count: number }[];
    by_region: { region: string; tracked_ads: number; row_count: number }[];
    by_department: { code_dept: string; tracked_ads: number; row_count: number }[];
  };
  data: {
    rows: DspCampaignData[];
    total: number;
    page: number;
  };
}

/* ── SSE event types ─────────────────────────── */

export type CampaignImportEvent =
  | { type: 'parsing'; message: string }
  | { type: 'progress'; processed: number; total: number; message: string }
  | { type: 'matching'; matched: number; total_france: number; message: string }
  | { type: 'complete'; report: CampaignImportReport }
  | { type: 'error'; message: string };

export interface CampaignImportReport {
  campaign_id: string;
  campaign_name: string;
  total_rows: number;
  countries: string[];
  total_france: number;
  matched_iris: number;
  pct_matched: number;
}

/* ── Geo-Equity analysis types ──────────────── */

export interface EquityAnalysisStats {
  total_impressions: number;
  total_population: number;
  avg_equity: number;
  zones_sous_servies: number;
  zones_sur_servies: number;
  zones_equilibrees: number;
  total_zones: number;
}

export const POPULATION_TARGETS = [
  { value: 'population', label: 'Population totale' },
  { value: 'pop_15_29', label: 'Jeunes 15-29 ans' },
  { value: 'pop_30_44', label: 'Adultes 30-44 ans' },
  { value: 'nb_csp_cadre', label: 'CSP+ (cadres)' },
  { value: 'nb_diplome_sup', label: 'Diplômés supérieur' },
  { value: 'nb_menages', label: 'Nombre de ménages' },
  { value: 'rev_median', label: 'Revenus médians (€)' },
] as const;

export type PopulationField = typeof POPULATION_TARGETS[number]['value'];
