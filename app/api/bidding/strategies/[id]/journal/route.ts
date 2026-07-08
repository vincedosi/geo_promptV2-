/**
 * GET /api/bidding/strategies/[id]/journal
 *
 * Merge bidding_agent_actions + bidding_drift_events + agent_recommendations
 * en un journal unifié trié chronologiquement, agrégé par jour.
 *
 * Réponse :
 *   {
 *     entries: [
 *       { date: 'YYYY-MM-DD', events: [{ at, type, severity, title, body, payload }] }
 *     ],
 *     count: number
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

interface JournalEvent {
  at: string;
  type: 'action' | 'drift' | 'recommendation';
  subtype: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | 'opportunity' | 'warning';
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  const [actionsRes, driftsRes, recosRes] = await Promise.all([
    supabase.from('bidding_agent_actions')
      .select('id, intent, trigger_source, agent_response, recommendations, action_taken, applied_at, llm_model, autonomy_level_at_time, created_at')
      .eq('strategy_id', id)
      .order('created_at', { ascending: true }),
    supabase.from('bidding_drift_events')
      .select('id, postal_code, severity, drift_type, description, metric_before, metric_after, delta, threshold, detected_at, resolved_at, resolution_notes')
      .eq('strategy_id', id)
      .order('detected_at', { ascending: true }),
    supabase.from('agent_recommendations')
      .select('id, category, severity, title, body, status, generated_at, applied_at, proposed_action')
      .eq('strategy_id', id)
      .order('generated_at', { ascending: true }),
  ]);

  const events: JournalEvent[] = [];

  for (const a of (actionsRes.data ?? []) as Array<{ id: string; intent: string; trigger_source: string; agent_response: string | null; recommendations: Record<string, unknown> | null; action_taken: string | null; applied_at: string | null; llm_model: string | null; created_at: string }>) {
    const at = a.applied_at ?? a.created_at;
    events.push({
      at,
      type: 'action',
      subtype: a.intent,
      severity: 'info',
      title: titleForAction(a.intent),
      body: a.agent_response ?? '',
      payload: { ...a.recommendations, trigger_source: a.trigger_source, action_taken: a.action_taken, llm_model: a.llm_model },
    });
  }

  for (const d of (driftsRes.data ?? []) as Array<{ id: string; postal_code: string; severity: 'low' | 'medium' | 'high' | 'critical'; drift_type: string; description: string; detected_at: string; resolved_at: string | null; resolution_notes: string | null }>) {
    events.push({
      at: d.detected_at,
      type: 'drift',
      subtype: d.drift_type,
      severity: d.severity,
      title: `Drift ${d.drift_type} · CP ${d.postal_code}`,
      body: d.description,
      payload: { resolved_at: d.resolved_at, resolution: d.resolution_notes },
    });
  }

  for (const r of (recosRes.data ?? []) as Array<{ id: string; category: string; severity: 'info' | 'opportunity' | 'warning'; title: string; body: string; status: string; generated_at: string; applied_at: string | null; proposed_action: Record<string, unknown> | null }>) {
    events.push({
      at: r.generated_at,
      type: 'recommendation',
      subtype: r.category,
      severity: r.severity,
      title: `Reco · ${r.title}`,
      body: r.body,
      payload: { status: r.status, applied_at: r.applied_at, action: r.proposed_action },
    });
  }

  events.sort((a, b) => a.at.localeCompare(b.at));

  // Group by date (YYYY-MM-DD)
  const byDate = new Map<string, JournalEvent[]>();
  for (const e of events) {
    const date = e.at.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(e);
  }
  const entries = [...byDate.entries()].map(([date, events]) => ({ date, events }));
  entries.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ entries, count: events.length });
}

function titleForAction(intent: string): string {
  switch (intent) {
    case 'init': return 'Initialisation de la stratégie';
    case 'train': return 'Entraînement modèle ML';
    case 'predict': return 'Prédiction multipliers';
    case 'drift_analysis': return 'Analyse de drift';
    case 'recommendation': return 'Recommandation générée';
    case 'curve_change': return 'Ajustement de la courbe';
    case 'mode_change': return "Changement de mode d'exécution";
    case 'convergence': return 'Convergence détectée';
    case 'end_of_campaign': return 'Fin de campagne';
    default: return intent;
  }
}
