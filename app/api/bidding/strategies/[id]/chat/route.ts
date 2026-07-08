/**
 * POST /api/bidding/strategies/[id]/chat
 *   → Streaming SSE Gemini avec function calling.
 *     Tools : get_zone_detail, simulate_curve_change, compare_with_baseline.
 *     Persiste les messages user et assistant dans agent_chat_messages.
 *
 * GET /api/bidding/strategies/[id]/chat
 *   → Renvoie l'historique des 30 derniers messages.
 */
import { NextRequest, NextResponse } from 'next/server';
import { streamText } from 'ai';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';
import { createModel } from '@/lib/chat/providers';
import {
  aggregateByZone, computeGlobalKpis, type ComparisonRow,
} from '@/lib/bidding-ml/comparison';
import { resolvePrimaryMetric, resolveWeightingTarget, getMetricLabels } from '@/lib/bidding-ml/metric-labels';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  const { data, error } = await supabase
    .from('agent_chat_messages')
    .select('*')
    .eq('strategy_id', id)
    .order('created_at', { ascending: true })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { id } = await params;

  let body: { message: string; reset?: boolean };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  if (!body.message || typeof body.message !== 'string' || body.message.length > 2000) {
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  if (body.reset) {
    await supabase.from('agent_chat_messages').delete().eq('strategy_id', id);
  }

  // Charge contexte stratégie
  const { data: strategy } = await supabase
    .from('bidding_strategies')
    .select('id, name, algorithm_code, objective_code, weighting_mode, in_zone_weights, execution_mode')
    .eq('id', id)
    .single();
  if (!strategy) return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  // Charge historique des derniers messages
  const { data: history } = await supabase
    .from('agent_chat_messages')
    .select('role, content')
    .eq('strategy_id', id)
    .order('created_at', { ascending: true })
    .limit(20);
  const priorMessages = ((history ?? []) as Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // Persiste le message utilisateur immédiatement
  await supabase.from('agent_chat_messages').insert({
    strategy_id: id,
    user_id: profile.id,
    role: 'user',
    content: body.message,
  });

  // Récupère les data réelles de la stratégie pour les passer DANS le prompt
  // (alternative robuste au function-calling, cohérente avec la version SDK).
  const { data: cmpRows } = await supabase.rpc('get_strategy_comparison_data', {
    p_strategy_id: id, p_date_from: null, p_date_to: null,
  });
  const allRows = (cmpRows ?? []) as ComparisonRow[];

  const objRes = await supabase
    .from('bidding_objectives')
    .select('code, required_metrics, display_name_fr')
    .eq('code', strategy.objective_code)
    .maybeSingle();
  const primaryMetric = resolvePrimaryMetric(objRes.data?.required_metrics?.[0]);
  const labels = getMetricLabels(primaryMetric);
  const target = resolveWeightingTarget(
    strategy.weighting_mode,
    (strategy.in_zone_weights ?? null) as Record<string, unknown> | null,
  );

  let insseValues: Record<string, number> = {};
  if (target.variableCode === 'abstention_pres_2022') {
    const { data: vData } = await supabase
      .from('dataset_abstention_2022')
      .select('code_postal, taux_abstention');
    for (const r of (vData ?? []) as Array<{ code_postal: string; taux_abstention: number }>) {
      insseValues[r.code_postal] = Number(r.taux_abstention);
    }
  }

  const globalKpis = computeGlobalKpis(allRows);
  const zones = aggregateByZone(allRows);
  const enriched = zones.map(z => ({
    cp: z.postal_code,
    real: z.impressions_real,
    sim: z.impressions_sim,
    delta: z.impressions_sim - z.impressions_real,
    multiplier: z.bid_multiplier,
    abstention: insseValues[z.postal_code] ?? null,
  }));

  const currentCurve = (strategy.in_zone_weights as { curve?: Array<{ x: number; y: number }> })?.curve ?? [];

  const dataContext = `DONNÉES STRATÉGIE (à utiliser pour répondre, ne pas inventer) :
- Nom : ${strategy.name}
- Algorithme : ${strategy.algorithm_code}
- Objectif : ${objRes.data?.display_name_fr ?? strategy.objective_code}
- Métrique principale : ${labels.name}
- Mode d'exécution : ${strategy.execution_mode}
- Variable cible : ${target.variableLabel ?? 'aucune (uniform)'}
- Cible métier : ${target.targetLabel}

Courbe actuelle :
${currentCurve.map(p => `  x=${p.x}% → ×${p.y}`).join('\n') || '  (uniforme)'}

KPIs globaux :
- Total impressions simulées : ${Math.round(globalKpis.total_impressions_sim).toLocaleString('fr-FR')}
- Total impressions réelles : ${Math.round(globalKpis.total_impressions_real).toLocaleString('fr-FR')}
- Lift : ${globalKpis.lift_pct.toFixed(1)}%
- Spend simulé : ${globalKpis.total_spend_sim.toFixed(0)}€ | réel : ${globalKpis.total_spend_real.toFixed(0)}€
- Zones : ${globalKpis.n_zones} | Jours : ${globalKpis.n_days}

Détail par zone (top 20 par |delta|) :
${enriched.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20).map(z =>
  `  CP ${z.cp} : real ${Math.round(z.real)} → sim ${Math.round(z.sim)} (Δ ${z.delta >= 0 ? '+' : ''}${Math.round(z.delta)}), mult ×${z.multiplier.toFixed(2)}${z.abstention !== null ? `, abst ${z.abstention.toFixed(1)}%` : ''}`
).join('\n')}`;

  const systemPrompt = `Tu es un consultant senior en geomarketing programmatique, intégré au module Pilotage ML de MAGELIAN.
Tu réponds aux questions du media planner sur la stratégie courante.

Règles :
- Réponds en français, ton factuel, max 4 phrases.
- Cite les chiffres exacts depuis les données fournies, ne les invente pas.
- Si la question demande des chiffres absents des données, dis-le clairement.
- Pas d'action destructive proposée.

${dataContext}`;

  const result = streamText({
    model: createModel('gemini'),
    system: systemPrompt,
    messages: [
      ...priorMessages,
      { role: 'user', content: body.message },
    ],
    temperature: 0.4,
    onFinish: async (final) => {
      try {
        await supabase.from('agent_chat_messages').insert({
          strategy_id: id,
          user_id: profile.id,
          role: 'assistant',
          content: final.text,
        });
      } catch { /* best-effort */ }
    },
  });

  return result.toTextStreamResponse();
}
