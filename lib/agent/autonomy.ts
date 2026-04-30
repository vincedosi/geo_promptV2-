/**
 * Enforcement du niveau d'autonomie de l'agent IA.
 *
 * Mappe chaque ProposedAction → {applied | suggested} selon le niveau
 * configuré dans agent_autonomy_settings. Effectue les UPDATE/INSERT côté
 * DB pour les actions auto-appliquées (bid changes, alerts, retrain, etc.).
 */
import { createAdminClient } from '@/lib/auth';
import type { AutonomyLevel, ProposedAction } from './types';

/**
 * Charge le niveau d'autonomie effectif pour un user / strategy donné.
 *
 * Priorité : strategy_override > user_default > 2 (Suggester par défaut).
 */
export async function getAutonomyLevel(opts: {
  user_id: string;
  strategy_id?: string;
}): Promise<AutonomyLevel> {
  const supabase = createAdminClient();

  // 1. Override par stratégie si fourni
  if (opts.strategy_id) {
    const { data: override } = await supabase
      .from('agent_autonomy_settings')
      .select('autonomy_level')
      .eq('scope_type', 'strategy_override')
      .eq('strategy_id', opts.strategy_id)
      .maybeSingle();
    if (override?.autonomy_level !== undefined && override.autonomy_level !== null) {
      return override.autonomy_level as AutonomyLevel;
    }
  }

  // 2. Défaut user
  const { data: defaultRow } = await supabase
    .from('agent_autonomy_settings')
    .select('autonomy_level')
    .eq('scope_type', 'user_default')
    .eq('user_id', opts.user_id)
    .maybeSingle();
  if (defaultRow?.autonomy_level !== undefined && defaultRow.autonomy_level !== null) {
    return defaultRow.autonomy_level as AutonomyLevel;
  }

  // 3. Fallback hardcodé : Suggester (l'agent propose, l'humain valide)
  return 2;
}

export interface EnforcementResult {
  applied: ProposedAction[];
  suggested: ProposedAction[];
}

/**
 * Sépare les actions en "auto-appliquées" vs "suggérées" selon le niveau,
 * et exécute les premières.
 *
 * Levels:
 *   0 (Observer)   : aucune action n'est exposée à l'utilisateur
 *   1 (Explainer)  : aucune action n'est exposée
 *   2 (Suggester)  : toutes en suggested
 *   3 (Auto-low)   : low-risk en applied, medium/high en suggested
 *   4 (Full-auto)  : toutes en applied
 */
export async function enforceAutonomy(
  actions: ProposedAction[],
  level: AutonomyLevel,
  ctx: { user_id: string; strategy_id?: string },
): Promise<EnforcementResult> {
  if (actions.length === 0) return { applied: [], suggested: [] };

  switch (level) {
    case 0:
    case 1:
      return { applied: [], suggested: [] };

    case 2:
      return { applied: [], suggested: actions };

    case 3: {
      const lowRisk = actions.filter(a => a.risk === 'low');
      const others = actions.filter(a => a.risk !== 'low');
      const applied = await Promise.all(lowRisk.map(a => applyAction(a, ctx)));
      return { applied: applied.filter(Boolean) as ProposedAction[], suggested: others };
    }

    case 4: {
      const applied = await Promise.all(actions.map(a => applyAction(a, ctx)));
      return { applied: applied.filter(Boolean) as ProposedAction[], suggested: [] };
    }
  }
}

/** Exécute une action et retourne null en cas d'échec (loggé). */
export async function applyAction(
  action: ProposedAction,
  ctx: { user_id: string; strategy_id?: string },
): Promise<ProposedAction | null> {
  const supabase = createAdminClient();
  try {
    switch (action.type) {
      case 'log_event':
      case 'send_alert':
        // No-op DB : l'audit trail (bidding_agent_actions) sert déjà de log.
        // Pour 'send_alert', un futur connecteur (email/slack) viendra ici.
        return action;

      case 'apply_bid_change': {
        const { postal_code, country_code = 'FR', new_multiplier } = action.params as {
          postal_code?: string;
          country_code?: string;
          new_multiplier?: number;
        };
        if (!ctx.strategy_id || !postal_code || typeof new_multiplier !== 'number') {
          console.warn('[agent.applyAction] apply_bid_change params invalides', action.params);
          return null;
        }
        await supabase.from('bidding_zone_configs').upsert(
          {
            strategy_id: ctx.strategy_id,
            postal_code,
            country_code,
            bid_multiplier: new_multiplier,
            is_active: true,
          },
          { onConflict: 'strategy_id,postal_code,country_code' },
        );
        return action;
      }

      case 'pause_strategy': {
        if (!ctx.strategy_id) return null;
        await supabase
          .from('bidding_strategies')
          .update({ status: 'paused' })
          .eq('id', ctx.strategy_id);
        return action;
      }

      case 'retrain_model': {
        // Délègue à la route Next.js qui appelle Modal.
        // En auto-apply, on POST sans attendre le résultat (fire-and-forget côté worker).
        if (!ctx.strategy_id) return null;
        const url = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
        try {
          await fetch(`${url}/api/bidding/train`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strategy_id: ctx.strategy_id }),
          });
        } catch (e) {
          console.warn('[agent.applyAction] retrain fire-and-forget failed', e);
        }
        return action;
      }

      default:
        console.warn('[agent.applyAction] type d\'action inconnu', action.type);
        return null;
    }
  } catch (e) {
    console.error('[agent.applyAction] erreur', action.type, e);
    return null;
  }
}
