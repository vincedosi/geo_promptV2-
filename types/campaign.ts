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
  total_unique_impressions: number;
  countries: string[] | null;
  created_at: string;
  created_by: string | null;
  /** Correction manuelle du statut de cycle de vie (paused/ended/archived), ou null si aucune. */
  status_override: 'paused' | 'ended' | 'archived' | null;
  /** Sous-clés namespacées (media_plan, channels…) — voir `lib/campaigns/channels.ts`. */
  geo_strategy?: Record<string, unknown> | null;
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
  unique_impressions: number;
  media: string | null;
  code_iris: string | null;
  code_commune: string | null;
  matched_at: string | null;
}

/* ── API response types ──────────────────────── */

export interface CampaignListItem extends DspCampaign {
  total_rows: number;
  france_rows: number;
  matched_iris: number;
  /** Date de la dernière ligne de données importée (signal d'attention). */
  last_data_date: string | null;
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
