/**
 * GET /api/bidding/strategies/[id]/recommendations
 *   → liste les reco (pending par défaut, ?status=all|applied|ignored)
 *
 * POST /api/bidding/strategies/[id]/recommendations
 *   → génère 2-5 nouvelles recommandations via Gemini avec validation Zod stricte,
 *     persiste en DB. Si une reco équivalente existe déjà (même title pending),
 *     on ne la duplique pas.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';
import { createModel } from '@/lib/chat/providers';
import {
  aggregateByZone, computeGlobalKpis, type ComparisonRow,
} from '@/lib/bidding-ml/comparison';
import { computeTargetingKpis } from '@/lib/bidding-ml/targeting-kpis';
import { resolvePrimaryMetric, resolveWeightingTarget, getMetricLabels } from '@/lib/bidding-ml/metric-labels';
import { createRateLimiter, rateLimitResponse, getClientKey } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const limiter = createRateLimiter({ max: 5, window: '60 s', prefix: 'geo:rl:reco' });

const ProposedActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update_curve'),
    new_curve: z.array(z.object({ x: z.number(), y: z.number() })).min(2),
  }),
  z.object({
    type: z.literal('adjust_zone_multiplier'),
    postal_code: z.string(),
    new_multiplier: z.number().min(0).max(5),
  }),
  z.object({
    type: z.literal('change_execution_mode'),
    new_mode: z.enum(['monitor_only', 'suggest', 'auto']),
  }),
  z.object({
    type: z.literal('retrain_zone'),
    postal_code: z.string(),
  }),
  z.object({
    type: z.literal('no_action'),
  }),
]);

const RecoItemSchema = z.object({
  category: z.enum(['curve_tuning', 'zone_focus', 'budget', 'frequency', 'target_alignment', 'other']),
  severity: z.enum(['info', 'opportunity', 'warning']),
  title: z.string().min(8).max(120),
  body: z.string().min(40).max(800),
  proposed_action: ProposedActionSchema.nullable(),
});

const RecoListSchema = z.object({
  recommendations: z.array(RecoItemSchema).min(1).max(5),
});

type RecoItem = z.infer<typeof RecoItemSchema>;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'pending';

  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  let query = supabase
    .from('agent_recommendations')
    .select('*')
    .eq('strategy_id', id)
    .order('generated_at', { ascending: false })
    .limit(20);

  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ recommendations: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  const { ok, retrySec } = await limiter(`${profile.id}:${getClientKey(request)}`);
  if (!ok) return rateLimitResponse(retrySec);

  const [stratRes, cmpRes] = await Promise.all([
    supabase
      .from('bidding_strategies')
      .select('id, name, algorithm_code, objective_code, weighting_mode, in_zone_weights, execution_mode')
      .eq('id', id)
      .single(),
    supabase.rpc('get_strategy_comparison_data', { p_strategy_id: id, p_date_from: null, p_date_to: null }),
  ]);

  if (stratRes.error || !stratRes.data) {
    return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });
  }
  if (cmpRes.error) {
    return NextResponse.json({ error: cmpRes.error.message }, { status: 500 });
  }

  const strategy = stratRes.data;
  const rows = (cmpRes.data ?? []) as ComparisonRow[];
  if (rows.length === 0) {
    return NextResponse.json({ error: 'no_data', message: "Aucune donnée de simulation. Lance un cycle predict d'abord." }, { status: 400 });
  }

  const objRes = await supabase
    .from('bidding_objectives')
    .select('code, required_metrics, display_name_fr, display_name')
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

  const globalKpis = computeGlobalKpis(rows);
  const targetingKpis = target.variableCode && Object.keys(insseValues).length > 0
    ? computeTargetingKpis(rows, insseValues, primaryMetric, target.highIsTarget)
    : null;

  const zones = aggregateByZone(rows);
  const fields = primaryMetric === 'impressions' ? { real: 'impressions_real', sim: 'impressions_sim' }
    : primaryMetric === 'clicks' ? { real: 'clicks_real', sim: 'clicks_sim' }
    : primaryMetric === 'spend' ? { real: 'spend_real', sim: 'spend_sim' }
    : { real: 'leads_real', sim: 'leads_sim' };
  const enriched = zones.map(z => {
    const real = Number((z as unknown as Record<string, number>)[fields.real] ?? 0);
    const sim = Number((z as unknown as Record<string, number>)[fields.sim] ?? 0);
    return {
      cp: z.postal_code,
      real, sim, delta: sim - real,
      mult: z.bid_multiplier,
      abstention: insseValues[z.postal_code] ?? null,
    };
  });
  const topGains = [...enriched].sort((a, b) => b.delta - a.delta).slice(0, 5);
  const topLosses = [...enriched].sort((a, b) => a.delta - b.delta).slice(0, 5);

  const currentCurve = (strategy.in_zone_weights as { curve?: Array<{ x: number; y: number }> })?.curve ?? [];

  const systemPrompt = `Tu es un consultant senior en geomarketing programmatique. Tu analyses une stratégie de bidding ML et tu produis des recommandations concrètes pour un media planner.

Règles strictes :
- Génère 2 à 5 recommandations, pas plus.
- Chaque reco a une category, une severity, un title (titre punchy < 120 caractères), un body (50-150 mots, factuel, structuré) et un proposed_action exécutable.
- Si tu n'as rien d'utile à proposer dans une catégorie, ne génère pas de reco vide.
- Privilégie la diversité de catégories (pas 5 reco curve_tuning).
- proposed_action peut être null si la reco est purement informative.

Catégories possibles :
- curve_tuning : ajuster la courbe de pondération INSEE (ex: rehausser le palier 35→40)
- zone_focus  : focus sur une zone spécifique (renforcement ou désexposition)
- budget      : ajustement du budget total ou daily
- frequency   : fréquence d'exposition (cap)
- target_alignment : amélioration de l'alignement diffusion × cible
- other       : autres

Sévérités :
- info        : observation neutre
- opportunity : action recommandée à fort potentiel positif
- warning     : risque ou anomalie à corriger

Actions possibles (proposed_action.type) :
- update_curve : nouvelle courbe complète (>= 2 points triés par x)
- adjust_zone_multiplier : ajuster un CP spécifique
- change_execution_mode : passer en monitor_only / suggest / auto
- retrain_zone : déclencher un train ciblé sur un CP
- no_action : aucune action automatique disponible

Réponds UNIQUEMENT en JSON conforme au schéma. Pas de markdown, pas de commentaire.`;

  const userPrompt = `Stratégie : ${strategy.name}
Algorithme : ${strategy.algorithm_code}
Objectif : ${objRes.data?.display_name_fr ?? strategy.objective_code}
Métrique principale : ${labels.name}
Mode d'exécution actuel : ${strategy.execution_mode}
Variable de pondération : ${target.variableLabel ?? 'aucune (uniform)'}
Cible métier : ${target.targetLabel}

Courbe actuelle :
${currentCurve.map(p => `  x=${p.x}% → ×${p.y}`).join('\n') || '  (uniforme)'}

KPI globaux :
- Total ${labels.name.toLowerCase()} simulées : ${Math.round(globalKpis.total_impressions_sim).toLocaleString('fr-FR')}
- Total ${labels.name.toLowerCase()} réelles  : ${Math.round(globalKpis.total_impressions_real).toLocaleString('fr-FR')}
- Spend simulé : ${globalKpis.total_spend_sim.toFixed(0)} € | réel : ${globalKpis.total_spend_real.toFixed(0)} €
- Zones : ${globalKpis.n_zones} | Jours : ${globalKpis.n_days}
${targetingKpis ? `
KPI ciblage :
- Part on-cible avant : ${(targetingKpis.on_target_share_real * 100).toFixed(1)}%
- Part on-cible après : ${(targetingKpis.on_target_share_sim * 100).toFixed(1)}%
- Δ part on-cible : ${targetingKpis.share_delta_pp >= 0 ? '+' : ''}${targetingKpis.share_delta_pp.toFixed(1)} pts
- Corrélation Pearson avant → après : ${targetingKpis.correlation_real.toFixed(2)} → ${targetingKpis.correlation_sim.toFixed(2)}
` : ''}
Top 5 gains :
${topGains.map(g => `  CP ${g.cp} : Δ +${Math.round(g.delta).toLocaleString('fr-FR')} (×${g.mult.toFixed(2)})${g.abstention !== null ? ` abst. ${g.abstention.toFixed(1)}%` : ''}`).join('\n')}

Top 5 pertes :
${topLosses.map(l => `  CP ${l.cp} : Δ ${Math.round(l.delta).toLocaleString('fr-FR')} (×${l.mult.toFixed(2)})${l.abstention !== null ? ` abst. ${l.abstention.toFixed(1)}%` : ''}`).join('\n')}

Génère 2 à 5 recommandations actionables maintenant.`;

  let recoList: { recommendations: RecoItem[] };
  try {
    const { object } = await generateObject({
      model: createModel('gemini'),
      schema: RecoListSchema,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.5,
      maxRetries: 1,
    });
    recoList = object;
  } catch (e) {
    return NextResponse.json({
      error: 'llm_generation_failed',
      message: e instanceof Error ? e.message : String(e),
    }, { status: 502 });
  }

  // Persistance — pas de doublon de pending sur même title
  const { data: existing } = await supabase
    .from('agent_recommendations')
    .select('title')
    .eq('strategy_id', id)
    .eq('status', 'pending');
  const existingTitles = new Set(((existing ?? []) as Array<{ title: string }>).map(r => r.title.toLowerCase()));

  const toInsert = recoList.recommendations
    .filter(r => !existingTitles.has(r.title.toLowerCase()))
    .map(r => ({
      strategy_id: id,
      category: r.category,
      severity: r.severity,
      title: r.title,
      body: r.body,
      proposed_action: r.proposed_action,
      status: 'pending' as const,
      model: 'gemini-2.5-flash',
    }));

  if (toInsert.length === 0) {
    return NextResponse.json({ inserted: 0, skipped: recoList.recommendations.length, reason: 'all_duplicates' });
  }

  const { data: inserted, error: insErr } = await supabase
    .from('agent_recommendations')
    .insert(toInsert)
    .select();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ inserted: inserted?.length ?? 0, recommendations: inserted });
}
