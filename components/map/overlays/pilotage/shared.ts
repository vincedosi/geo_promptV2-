/**
 * Types, tokens et constantes partagés par les vues de l'overlay Pilotage ML
 * — extraits de PilotageOverlay.tsx (2026-09-07), valeurs inchangées.
 */

export const fInter = "'Inter', system-ui, sans-serif";
export const fMono = "'JetBrains Mono', monospace";

export interface StrategyListItem {
  id: string;
  name: string;
  algorithm_code: string;
  objective_code: string;
  execution_mode: 'monitor_only' | 'suggest' | 'auto';
  status: string;
  is_demo: boolean;
  dsp_campaigns?: { id: string; name: string; dsp_source: string; is_demo: boolean } | null;
}

export interface StrategyMeta {
  strategy: {
    id: string; name: string; algorithm_code: string; objective_code: string;
    execution_mode: 'monitor_only' | 'suggest' | 'auto';
    is_demo: boolean; status: string;
    weighting_mode?: string | null;
    in_zone_weights?: Record<string, unknown> | null;
    activated_at?: string | null;
    status_changed_at?: string | null;
    init_preset_code?: string | null;
  };
  campaign: { id: string; name: string; is_demo: boolean } | null;
  objective: { code: string; required_metrics: string[] | null; display_name_fr?: string | null; display_name?: string | null } | null;
  active_model: { model_version: string } | null;
}

export interface DriftEvent { id: string; detected_at: string; postal_code: string | null; severity: string; }

export const isoDate = (s: string): string => s.slice(0, 10);

export const MODE_COLORS: Record<string, string> = {
  auto: '#3dffa0',
  suggest: '#f7b731',
  monitor_only: '#5b9bd5',
};

export interface CampaignLite { id: string; name: string; dsp_source: string }

export type PilotageInitialAction =
  | { type: 'new'; campaignId: string; draftId?: string }
  | { type: 'edit'; strategyId: string }
  | { type: 'history'; strategyId: string };

export type View =
  | { kind: 'list' }
  | { kind: 'wizard'; mode: 'create'; campaignId: string; campaignName?: string; draftId?: string }
  | { kind: 'wizard'; mode: 'edit'; strategyId: string }
  | { kind: 'history'; strategyId: string };
