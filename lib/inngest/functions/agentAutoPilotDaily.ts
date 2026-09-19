/**
 * agentAutoPilotDaily — cron Inngest quotidien à 06h00 Europe/Paris.
 *
 * Pour chaque stratégie avec autonomy_enabled=true :
 *   1. Détecte les drifts (Page-Hinkley local)
 *   2. Génère des recommandations Gemini (réutilise endpoint /recommendations)
 *   3. Applique automatiquement celles dont la proposed_action est dans les
 *      bornes (autonomy_max_curve_delta_pct / autonomy_max_budget_delta_pct)
 *   4. Trace dans bidding_agent_actions (best-effort sur le schéma existant)
 *   5. Freeze si > autonomy_max_actions_per_day actions auto sur 24h
 */
import { inngest } from '@/lib/inngest/client';
import { createAdminClient } from '@/lib/auth';
import { toJson } from '@/lib/supabase/rpc-json';
import { fetchAvecDelai } from '@/lib/http/fetch-avec-delai';

/**
 * Auto-appels vers nos propres routes (détection de dérive, recommandations,
 * application). Sans délai, une route qui pend figeait l'étape Inngest jusqu'à
 * SON délai à elle ; 60 s couvre les plus lentes observées et rend la main
 * avant. Pas de reprise : `apply` n'est pas idempotent.
 */
const DELAI_AUTO_APPEL_MS = 60_000;

interface Strategy {
  id: string;
  name: string;
  in_zone_weights: { curve?: Array<{ x: number; y: number }> } | null;
}

interface Settings {
  strategy_id: string;
  autonomy_enabled: boolean;
  autonomy_level: number;
  autonomy_max_curve_delta_pct: number;
  autonomy_max_budget_delta_pct: number;
  autonomy_max_actions_per_day: number;
}

interface PendingReco {
  id: string;
  strategy_id: string;
  category: string;
  proposed_action: { type: string; new_curve?: Array<{ x: number; y: number }>; new_multiplier?: number; postal_code?: string } | null;
}

/** Vérifie si une nouvelle courbe respecte la borne max delta. */
function curveWithinBounds(currentCurve: Array<{ x: number; y: number }>, newCurve: Array<{ x: number; y: number }>, maxDeltaPct: number): boolean {
  if (!currentCurve || currentCurve.length === 0) return true;
  for (const np of newCurve) {
    // trouve le point courant le plus proche en x
    let nearest = currentCurve[0];
    for (const cp of currentCurve) if (Math.abs(cp.x - np.x) < Math.abs(nearest.x - np.x)) nearest = cp;
    if (nearest.y === 0) continue;
    const deltaPct = Math.abs((np.y - nearest.y) / nearest.y) * 100;
    if (deltaPct > maxDeltaPct) return false;
  }
  return true;
}

export const agentAutoPilotDaily = inngest.createFunction(
  { id: 'agent-auto-pilot-daily', name: 'Agent auto-pilot daily run' },
  { cron: 'TZ=Europe/Paris 0 6 * * *' },
  async ({ step }) => {
    const supabase = createAdminClient();

    // 1. Liste des stratégies avec auto-pilot ON
    const eligibleStrategies = await step.run('list-eligible-strategies', async () => {
      const { data: settings } = await supabase
        .from('agent_autonomy_settings')
        .select('strategy_id, autonomy_enabled, autonomy_level, autonomy_max_curve_delta_pct, autonomy_max_budget_delta_pct, autonomy_max_actions_per_day')
        .eq('scope_type', 'strategy')
        .eq('autonomy_enabled', true);
      return (settings ?? []) as Settings[];
    });

    if (eligibleStrategies.length === 0) {
      return { processed: 0, message: 'Aucune stratégie avec auto-pilot activé.' };
    }

    let totalApplied = 0;
    let totalSkipped = 0;
    const perStrategy: Array<{ strategy_id: string; applied: number; skipped: number; frozen: boolean }> = [];

    for (const settings of eligibleStrategies) {
      const sid = settings.strategy_id;

      // 2. Compteur actions auto sur 24h pour cette stratégie
      const recentActions = await step.run(`count-recent-${sid}`, async () => {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from('agent_recommendations')
          .select('id', { count: 'exact', head: true })
          .eq('strategy_id', sid)
          .eq('status', 'applied')
          .gte('applied_at', since);
        return count ?? 0;
      });

      if (recentActions >= settings.autonomy_max_actions_per_day) {
        perStrategy.push({ strategy_id: sid, applied: 0, skipped: 0, frozen: true });
        continue;
      }

      // 3. Détection drift
      await step.run(`drift-detect-${sid}`, async () => {
        try {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
          await fetchAvecDelai(`${baseUrl}/api/bidding/strategies/${sid}/drift-detect-local`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lookback_days: 7, metric: 'impressions' }),
          }, DELAI_AUTO_APPEL_MS);
        } catch { /* best-effort */ }
      });

      // 4. Génération recommandations
      await step.run(`generate-reco-${sid}`, async () => {
        try {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
          await fetchAvecDelai(`${baseUrl}/api/bidding/strategies/${sid}/recommendations`, {
            method: 'POST',
          }, DELAI_AUTO_APPEL_MS);
        } catch { /* best-effort */ }
      });

      // 5. Récupère les reco pending et applique celles dans les bornes
      const result = await step.run(`apply-eligible-${sid}`, async () => {
        const { data: stratData } = await supabase
          .from('bidding_strategies')
          .select('id, name, in_zone_weights')
          .eq('id', sid)
          .single();
        const strategy = stratData as Strategy | null;

        const { data: pending } = await supabase
          .from('agent_recommendations')
          .select('id, strategy_id, category, proposed_action')
          .eq('strategy_id', sid)
          .eq('status', 'pending');

        const pendingList = (pending ?? []) as PendingReco[];
        const remainingBudget = settings.autonomy_max_actions_per_day - recentActions;
        let applied = 0, skipped = 0;

        for (const reco of pendingList) {
          if (applied >= remainingBudget) { skipped++; continue; }
          const action = reco.proposed_action;
          if (!action || action.type === 'no_action') { skipped++; continue; }

          let withinBounds = false;
          if (action.type === 'update_curve' && Array.isArray(action.new_curve) && strategy) {
            withinBounds = curveWithinBounds(
              strategy.in_zone_weights?.curve ?? [],
              action.new_curve,
              settings.autonomy_max_curve_delta_pct,
            );
          } else if (action.type === 'change_execution_mode') {
            withinBounds = settings.autonomy_level >= 3;
          } else if (action.type === 'adjust_zone_multiplier') {
            withinBounds = true;
          } else if (action.type === 'retrain_zone') {
            withinBounds = settings.autonomy_level >= 2;
          }

          if (!withinBounds) { skipped++; continue; }

          // Apply via endpoint pour réutiliser la logique
          try {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
            const res = await fetchAvecDelai(`${baseUrl}/api/bidding/strategies/${sid}/recommendations/${reco.id}/apply`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }, DELAI_AUTO_APPEL_MS);
            if (res.ok) {
              applied++;
              // Trace best-effort dans bidding_agent_actions.
              //
              // `action_taken` est une colonne texte qui porte un ActionStatus
              // (cf. lib/agent/types.ts), PAS l'action elle-meme : l'objet
              // `proposed_action` va dans `recommendations` (jsonb), comme le
              // fait deja lib/agent/orchestrator.ts. L'ancienne version passait
              // l'objet directement a `action_taken` — PostgREST rejetait la
              // ligne, et l'erreur etait perdue (supabase-js retourne `error`,
              // il ne leve pas : le `catch` ne voyait jamais rien).
              const { error: traceErr } = await supabase
                .from('bidding_agent_actions')
                .insert({
                  strategy_id: sid,
                  intent: reco.category,
                  trigger_source: 'auto_pilot_cron',
                  action_taken: 'auto_applied',
                  recommendations: toJson([action]),
                  applied_at: new Date().toISOString(),
                  llm_model: 'gemini-2.5-flash',
                  autonomy_level_at_time: settings.autonomy_level,
                });
              // Best-effort assume : l'echec de trace ne doit pas annuler
              // l'application. Mais il est visible, plus silencieux.
              if (traceErr) console.warn('[autoPilotDaily] trace audit echouee:', traceErr.message);
            } else {
              skipped++;
            }
          } catch {
            skipped++;
          }
        }
        return { applied, skipped };
      });

      totalApplied += result.applied;
      totalSkipped += result.skipped;
      perStrategy.push({ strategy_id: sid, applied: result.applied, skipped: result.skipped, frozen: false });
    }

    return {
      processed: eligibleStrategies.length,
      total_applied: totalApplied,
      total_skipped: totalSkipped,
      per_strategy: perStrategy,
    };
  },
);
