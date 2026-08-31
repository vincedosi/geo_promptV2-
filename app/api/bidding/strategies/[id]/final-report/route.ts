/**
 * POST /api/bidding/strategies/[id]/final-report
 *
 * Génère un bilan exécutif Gemini structuré (5 sections) sur la campagne
 * terminée. Cache mémoire long (1h) car la data est figée pour status=completed.
 *
 * Sections :
 *   - performance : synthèse globale (volumes, déplacement, économies)
 *   - wins        : 3 wins majeurs identifiés
 *   - limites     : 2 limites/apprentissages
 *   - reco_next   : 3 recommandations pour la prochaine campagne
 *   - roi         : estimation ROI annonceur en €
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';
import { createModel } from '@/lib/chat/providers';
import { aggregateByZone, computeGlobalKpis, type ComparisonRow } from '@/lib/bidding-ml/comparison';
import { computeTargetingKpis } from '@/lib/bidding-ml/targeting-kpis';
import { resolvePrimaryMetric, resolveWeightingTarget, getMetricLabels } from '@/lib/bidding-ml/metric-labels';
import { createRateLimiter, rateLimitResponse, getClientKey } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const limiter = createRateLimiter({ max: 5, window: '60 s', prefix: 'geo:rl:final-report' });

const ReportSchema = z.object({
  performance: z.string().min(40).max(800),
  wins: z.array(z.string().min(15).max(220)).min(2).max(3),
  limites: z.array(z.string().min(15).max(220)).min(1).max(2),
  reco_next: z.array(z.string().min(15).max(220)).min(2).max(3),
  roi: z.object({
    estimated_savings_eur: z.number().min(0),
    cpm_market_eur: z.number().min(0),
    cpm_optimized_eur: z.number().min(0),
    explanation: z.string().min(30).max(400),
  }),
});

interface CacheEntry {
  expires_at: number;
  payload: z.infer<typeof ReportSchema> & { model: string; generated_at: string; cached: boolean };
}
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000;

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

  const cached = CACHE.get(id);
  if (cached && cached.expires_at > Date.now()) {
    return NextResponse.json({ ...cached.payload, cached: true });
  }

  // ⛔ Nano : max 3 appels Supabase simultanes (CLAUDE.md) -> 3 puis 1.
  // La RPC de comparaison est la plus lourde, elle reste dans le 1er lot.
  const [stratRes, cmpRes, snapsRes] = await Promise.all([
    supabase.from('bidding_strategies')
      .select('id, name, algorithm_code, objective_code, weighting_mode, in_zone_weights, status, activated_at, status_changed_at, total_budget, currency, init_preset_code')
      .eq('id', id)
      .single(),
    supabase.rpc('get_strategy_comparison_data', { p_strategy_id: id, p_date_from: null, p_date_to: null }),
    supabase.from('bidding_curve_history')
      .select('applied_at, curve, triggered_by, reason')
      .eq('strategy_id', id)
      .order('applied_at', { ascending: true }),
  ]);

  const recosRes = await supabase.from('agent_recommendations')
    .select('title, status, applied_at, category')
    .eq('strategy_id', id)
    .order('generated_at', { ascending: true });

  if (stratRes.error || !stratRes.data) {
    return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });
  }
  if (cmpRes.error) return NextResponse.json({ error: cmpRes.error.message }, { status: 500 });

  const strategy = stratRes.data;
  const rows = (cmpRes.data ?? []) as ComparisonRow[];
  const snapshots = snapsRes.data ?? [];
  const recos = recosRes.data ?? [];

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

  const globalKpis = computeGlobalKpis(rows);
  const targetingKpis = target.variableCode && Object.keys(insseValues).length > 0
    ? computeTargetingKpis(rows, insseValues, primaryMetric, target.highIsTarget)
    : null;

  const zones = aggregateByZone(rows);
  const topGains = [...zones].sort((a, b) => (b.impressions_sim - b.impressions_real) - (a.impressions_sim - a.impressions_real)).slice(0, 5);

  const systemPrompt = `Tu es un consultant senior en geomarketing programmatique. Tu rédiges le bilan de fin de campagne pour un comité de direction d'annonceur grand compte.

Format strictement JSON, sections :
- performance : 60-100 mots, synthèse factuelle de la performance globale (volumes, déplacement vers la cible, comparaison avant/après).
- wins : tableau de 2-3 wins majeurs, chaque win = 1 phrase complète factuelle.
- limites : tableau de 1-2 limites ou apprentissages honnêtes.
- reco_next : tableau de 2-3 recommandations pour la prochaine campagne.
- roi : objet { estimated_savings_eur, cpm_market_eur, cpm_optimized_eur, explanation }. Hypothèse : le CPM marché TTD pour DOOH France est entre 3 et 6€. estimated_savings_eur = (cpm_market - cpm_optimized) * impressions_sim / 1000. Sois transparent sur les hypothèses dans explanation.

Style : factuel, pas d'emoji, pas de superlatif, ton consultant senior. Tutoiement interdit.`;

  const userPrompt = `BILAN DE FIN DE CAMPAGNE

Stratégie : ${strategy.name}
Algorithme : ${strategy.algorithm_code}
Objectif : ${objRes.data?.display_name_fr ?? strategy.objective_code}
Préset initial : ${strategy.init_preset_code ?? 'non précisé'}
Période : ${strategy.activated_at ? new Date(strategy.activated_at).toLocaleDateString('fr-FR') : '?'} → ${strategy.status_changed_at ? new Date(strategy.status_changed_at).toLocaleDateString('fr-FR') : '?'}
Budget total : ${strategy.total_budget ?? 'n/a'} ${strategy.currency ?? '€'}

KPIs globaux :
- ${labels.name} simulées : ${Math.round(globalKpis.total_impressions_sim).toLocaleString('fr-FR')}
- ${labels.name} réelles : ${Math.round(globalKpis.total_impressions_real).toLocaleString('fr-FR')}
- Lift global : ${globalKpis.lift_pct.toFixed(1)}%
- Spend simulé : ${globalKpis.total_spend_sim.toFixed(0)}€ | réel : ${globalKpis.total_spend_real.toFixed(0)}€
- Zones servies : ${globalKpis.n_zones} | Jours : ${globalKpis.n_days}
${targetingKpis ? `
KPIs ciblage abstention :
- Part on-cible avant : ${(targetingKpis.on_target_share_real * 100).toFixed(1)}%
- Part on-cible après : ${(targetingKpis.on_target_share_sim * 100).toFixed(1)}%
- Δ part on-cible : ${targetingKpis.share_delta_pp >= 0 ? '+' : ''}${targetingKpis.share_delta_pp.toFixed(1)} pts
- Corrélation Pearson : ${targetingKpis.correlation_real.toFixed(2)} → ${targetingKpis.correlation_sim.toFixed(2)}
- Volume redéployé hors-cible : ${Math.round(targetingKpis.reallocated_from_off_target).toLocaleString('fr-FR')}
` : ''}
Évolution courbe (${snapshots.length} snapshots) :
${snapshots.map((s: { applied_at: string; curve: unknown; triggered_by: string; reason: string | null }) => `  ${new Date(s.applied_at).toLocaleDateString('fr-FR')} · ${s.triggered_by} · ${s.reason?.slice(0, 100) ?? ''}`).join('\n')}

Recommandations agent (${recos.length}) :
${recos.map((r: { title: string; status: string; category: string }) => `  [${r.status}] ${r.category} · ${r.title}`).join('\n')}

Top 5 zones gain :
${topGains.map(z => `  CP ${z.postal_code} : Δ ${Math.round(z.impressions_sim - z.impressions_real).toLocaleString('fr-FR')} (×${z.bid_multiplier.toFixed(2)})`).join('\n')}

Génère le bilan exécutif complet.`;

  try {
    const { object } = await generateObject({
      model: createModel('gemini'),
      schema: ReportSchema,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.3,
      maxRetries: 1,
    });
    const payload = { ...object, model: 'gemini-2.5-flash', generated_at: new Date().toISOString(), cached: false };
    CACHE.set(id, { expires_at: Date.now() + TTL_MS, payload });
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({
      error: 'llm_generation_failed',
      message: e instanceof Error ? e.message : String(e),
    }, { status: 502 });
  }
}
