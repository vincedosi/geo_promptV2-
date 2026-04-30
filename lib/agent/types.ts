/**
 * Types partagés de l'agent IA superviseur (GeoAgent — chantier A4.5).
 */

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  0: 'Observer',
  1: 'Explainer',
  2: 'Suggester',
  3: 'Auto low-risk',
  4: 'Full auto',
};

/** Risque associé à une action proposée. */
export type ActionRisk = 'low' | 'medium' | 'high';

/** Type d'action que l'agent peut proposer / exécuter. */
export type ActionType =
  | 'apply_bid_change'   // UPDATE bidding_zone_configs
  | 'pause_strategy'     // UPDATE bidding_strategies.status
  | 'retrain_model'      // POST Modal /train
  | 'send_alert'         // log + notification
  | 'log_event';         // log seulement

export interface ProposedAction {
  type: ActionType;
  risk: ActionRisk;
  params: Record<string, unknown>;
  reasoning: string;
}

export type TriggerSource = 'user_chat' | 'proactive' | 'api';

export type ActionStatus =
  | 'none'
  | 'suggested'
  | 'auto_applied'
  | 'human_approved'
  | 'human_rejected';

export interface AgentContext {
  /** Stratégie associée à l'interaction (si applicable). */
  strategy_id?: string;
  /** Drift event ciblé (si applicable). */
  drift_event_id?: string;
  /** Campagne ciblée (si applicable). */
  campaign_id?: string;
  /** Contexte free-form supplémentaire. */
  extra?: Record<string, unknown>;
}

export interface IntentInput {
  user: { id: string };
  context: AgentContext;
  autonomy_level: AutonomyLevel;
  message: string;
  trigger_source: TriggerSource;
}

export interface IntentOutput {
  /** Texte à afficher dans le chat (français, pas de bloc JSON). */
  response_text: string;
  /** Recommandations structurées (parsées du JSON LLM). */
  proposed_actions: ProposedAction[];
  /** Status final après enforcement autonomie. */
  action_status: ActionStatus;
  /** Métriques LLM pour audit. */
  tokens_in?: number;
  tokens_out?: number;
  duration_ms?: number;
}

export interface AgentIntent {
  /** Code unique (matché contre INTENT_REGISTRY). */
  code: string;
  /** Libellé fr pour UI. */
  display_name_fr: string;
  description: string;
  /** Champs de context.required à valider avant exécution. */
  required_context?: (keyof AgentContext)[];
  handler: (input: IntentInput) => Promise<IntentOutput>;
}

/** Sortie structurée typée d'analyze_drift. */
export interface DriftAnalysisOutput {
  summary_french: string;
  diagnosis: {
    likely_causes: string[];
    confidence: 'high' | 'medium' | 'low';
    data_evidence: string;
  };
  proposed_actions?: ProposedAction[];
  next_check_at?: string; // ISO
}
