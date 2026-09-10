/**
 * MAGELIAN — logging des événements DSP dans dsp_api_logs.
 * Best-effort : n'interrompt JAMAIS la requête principale (try/catch silencieux).
 * L'appelant DOIT sanitiser `detail` — aucun secret ne doit y figurer.
 */
import { createAdminClient } from '@/lib/auth';
import { toJson } from '@/lib/supabase/rpc-json';
import type { DspProvider, DspLogCategory, DspLogLevel } from '@/types/dsp';

interface LogDspEventParams {
  orgId: string;
  provider: DspProvider;
  category: DspLogCategory;
  level?: DspLogLevel;
  action: string;
  statusCode?: number | null;
  durationMs?: number | null;
  message?: string;
  detail?: Record<string, unknown>;
}

export async function logDspEvent(params: LogDspEventParams): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from('dsp_api_logs').insert({
      organization_id: params.orgId,
      provider: params.provider,
      category: params.category,
      level: params.level ?? 'info',
      action: params.action,
      status_code: params.statusCode ?? null,
      duration_ms: params.durationMs ?? null,
      message: params.message ?? null,
      detail: toJson(params.detail ?? {}),
    });
  } catch (e) {
    console.error('[logDspEvent] échec insertion log (ignoré):', e);
  }
}
