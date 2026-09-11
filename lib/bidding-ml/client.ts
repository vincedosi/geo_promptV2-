/**
 * Client TypeScript pour le service Modal Bidding ML.
 *
 * `MODAL_BIDDING_ML_URL` doit être un préfixe Modal sans suffixe d'endpoint,
 * exemple : `https://vincedosis--bidding-ml`. Ce client ajoute
 * `-predict.modal.run`, `-train.modal.run`, etc.
 *
 * Si `MODAL_BIDDING_ML_URL` contient déjà un suffixe complet (ex.
 * `https://vincedosis--bidding-ml-predict.modal.run`), on dérive le préfixe
 * en strippant le 1er suffixe connu — pratique tant que l'orchestration
 * locale n'est pas formalisée.
 */

import { fetchAvecDelai } from '@/lib/http/fetch-avec-delai';

export type ExecutionMode = 'monitor_only' | 'suggest' | 'auto';

export interface PredictResponse {
  strategy_id: string;
  mode: ExecutionMode;
  n_predictions: number;
  n_persisted: number;
  duration_ms: number;
  warning?: string;
  error?: string;
  status?: number;
}

export interface TrainResponse {
  strategy_id: string;
  model_id: string;
  model_version: string;
  n_train_samples: number;
  training_window: [string, string];
  duration_ms: number;
  error?: string;
  status?: number;
}

export interface DriftResponse {
  strategy_id: string;
  n_drifts_detected: number;
  n_inserted: number;
  lookback_days: number;
  duration_ms: number;
  error?: string;
  status?: number;
}

const KNOWN_SUFFIXES = ['-predict.modal.run', '-train.modal.run', '-detect-drift.modal.run'];

function getModalPrefix(): string {
  const raw = process.env.MODAL_BIDDING_ML_URL;
  if (!raw) {
    throw new Error('MODAL_BIDDING_ML_URL non configurée dans .env.local');
  }
  let url = raw.trim().replace(/\/+$/, '');
  for (const suffix of KNOWN_SUFFIXES) {
    if (url.endsWith(suffix)) {
      url = url.slice(0, -suffix.length);
      break;
    }
  }
  return url;
}

async function callModal<T>(endpointSuffix: string, body: Record<string, unknown>): Promise<T> {
  const prefix = getModalPrefix();
  const url = `${prefix}${endpointSuffix}`;
  const res = await fetchAvecDelai(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Modal ${endpointSuffix} → ${res.status} ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Modal ${endpointSuffix} → réponse JSON invalide : ${text.slice(0, 300)}`);
  }
}

export function predictForStrategy(strategyId: string, days?: number): Promise<PredictResponse> {
  const body: Record<string, unknown> = { strategy_id: strategyId };
  if (days !== undefined) body.days = days;
  return callModal<PredictResponse>('-predict.modal.run', body);
}

export function trainModel(strategyId: string, daysBack = 30): Promise<TrainResponse> {
  return callModal<TrainResponse>('-train.modal.run', {
    strategy_id: strategyId,
    days_back: daysBack,
  });
}

export function detectDrift(strategyId: string, lookbackDays = 7): Promise<DriftResponse> {
  return callModal<DriftResponse>('-detect-drift.modal.run', {
    strategy_id: strategyId,
    lookback_days: lookbackDays,
  });
}
