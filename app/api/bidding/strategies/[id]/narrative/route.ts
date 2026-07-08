/**
 * POST /api/bidding/strategies/[id]/narrative
 *
 * Génère un récit factuel (60 mots) + 1 insight non-évident sur l'impact
 * de la stratégie, via Gemini 2.5 Flash. Cache mémoire 30 min côté serveur
 * (clé = strategy_id + last_data_hash).
 *
 * Réponse :
 *   {
 *     narrative: string,    // ~60 mots, ton consultant senior factuel
 *     insight:   string,    // 1 phrase d'insight non-évident
 *     confidence:'high'|'medium'|'low',
 *     model:     string,    // ex: 'gemini-2.5-flash'
 *     cached:    boolean
 *   }
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
export const maxDuration = 30;

const limiter = createRateLimiter({ max: 5, window: '60 s', prefix: 'geo:rl:narrative' });

const NarrativeSchema = z.object({
  narrative: z.string().min(40).max(600),
  insight: z.string().min(20).max(300),
  confidence: z.enum(['high', 'medium', 'low']),
});

interface CacheEntry {
  hash: string;
  expires_at: number;
  payload: z.infer<typeof NarrativeSchema> & { model: string; cached: boolean };
}
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 30 * 60 * 1000;

function hashRows(rows: ComparisonRow[]): string {
  // Hash léger : nb rows + sum impressions sim + dernière date.
  // Suffisant pour invalider quand un train/predict tourne.
  let sumSim = 0;
  let lastDate = '';
  for (const r of rows) {
    sumSim += Number(r.impressions_sim ?? 0);
    if (r.date > lastDate) lastDate = r.date;
  }
  return `${rows.length}:${Math.round(sumSim)}:${lastDate}`;
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

  // 1. Charge meta + objective + comparison rows
  const [stratRes, cmpRes] = await Promise.all([
    supabase
      .from('bidding_strategies')
      .select('id, name, algorithm_code, objective_code, weighting_mode, in_zone_weights, campaign_id')
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
    return NextResponse.json({
      narrative: 'Aucune donnée de simulation disponible. Lance un cycle predict pour générer le récit.',
      insight: "L'agent ne peut pas analyser une stratégie sans données.",
      confidence: 'low' as const,
      model: 'fallback',
      cached: false,
    });
  }

  // 2. Cache check
  const dataHash = hashRows(rows);
  const cached = CACHE.get(id);
  if (cached && cached.hash === dataHash && cached.expires_at > Date.now()) {
    return NextResponse.json({ ...cached.payload, cached: true });
  }

  // 3. Charge objective + insee values si by_insee_variable
  const [objRes] = await Promise.all([
    supabase
      .from('bidding_objectives')
      .select('code, required_metrics, display_name, display_name_fr, formula')
      .eq('code', strategy.objective_code)
      .maybeSingle(),
  ]);

  const primaryMetric = resolvePrimaryMetric(objRes.data?.required_metrics?.[0]);
  const labels = getMetricLabels(primaryMetric);
  const target = resolveWeightingTarget(
    strategy.weighting_mode,
    (strategy.in_zone_weights ?? null) as Record<string, unknown> | null,
  );

  let insseValues: Record<string, number> = {};
  if (target.variableCode) {
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

  // Top zones gain / perte
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
      abstention: insseValues[z.postal_code] ?? null,
    };
  });
  const topGains = [...enriched].sort((a, b) => b.delta - a.delta).slice(0, 5);
  const topLosses = [...enriched].sort((a, b) => a.delta - b.delta).slice(0, 5);

  // 4. Prompt structuré pour Gemini
  const systemPrompt = `Tu es un consultant senior en geomarketing programmatique. Ton lecteur : un comité de direction d'annonceur grand compte.

Style : factuel, précis, concis, ton de consultant senior.
Pas d'emoji, pas de superlatif marketing, pas de jargon technique creux.
Tutoie pas, vouvoie pas — formule en discours indirect ("la stratégie a déplacé...").

Tu produis :
1. narrative : 50-70 mots qui résument l'impact de la stratégie. Mentionne le volume principal, le déplacement vers la cible, la stabilité du budget.
2. insight : 1 phrase qui révèle un fait non-évident dans les données (ex: une zone qui contredit la tendance, un effet de seuil sur la courbe, une concentration géographique surprenante).
3. confidence : 'high' si > 100 zones et > 7 jours, 'medium' si > 20 zones, 'low' sinon.

Réponds UNIQUEMENT en JSON conforme au schéma demandé.`;

  const userPrompt = `Stratégie : ${strategy.name}
Algorithme : ${strategy.algorithm_code}
Objectif : ${objRes.data?.display_name_fr ?? objRes.data?.display_name ?? strategy.objective_code}
Métrique principale : ${labels.name}
Variable de pondération : ${target.variableLabel ?? 'aucune'}
Cible : ${target.targetLabel}

KPI globaux :
- Total ${labels.name.toLowerCase()} simulées : ${Math.round(globalKpis.total_impressions_sim).toLocaleString('fr-FR')}
- Total ${labels.name.toLowerCase()} réelles  : ${Math.round(globalKpis.total_impressions_real).toLocaleString('fr-FR')}
- Spend total simulé : ${globalKpis.total_spend_sim.toFixed(2)} €
- Spend total réel   : ${globalKpis.total_spend_real.toFixed(2)} €
- Zones servies      : ${globalKpis.n_zones}
- Jours              : ${globalKpis.n_days}
${targetingKpis ? `
KPI ciblage :
- Part ${labels.name.toLowerCase()} sur cible avant algo : ${(targetingKpis.on_target_share_real * 100).toFixed(1)}%
- Part ${labels.name.toLowerCase()} sur cible après algo : ${(targetingKpis.on_target_share_sim * 100).toFixed(1)}%
- Δ part on-cible : ${targetingKpis.share_delta_pp >= 0 ? '+' : ''}${targetingKpis.share_delta_pp.toFixed(1)} pts
- Corrélation Pearson avant : ${targetingKpis.correlation_real.toFixed(2)}
- Corrélation Pearson après : ${targetingKpis.correlation_sim.toFixed(2)}
- Volume redéployé hors-cible : ${Math.round(targetingKpis.reallocated_from_off_target).toLocaleString('fr-FR')}
` : ''}

Top 5 gains :
${topGains.map(g => `  CP ${g.cp} : Δ +${Math.round(g.delta).toLocaleString('fr-FR')} ${labels.unitShort}${g.abstention !== null ? ` (abst. ${g.abstention.toFixed(1)}%)` : ''}`).join('\n')}

Top 5 pertes :
${topLosses.map(l => `  CP ${l.cp} : Δ ${Math.round(l.delta).toLocaleString('fr-FR')} ${labels.unitShort}${l.abstention !== null ? ` (abst. ${l.abstention.toFixed(1)}%)` : ''}`).join('\n')}`;

  // 5. Appel Gemini avec validation Zod
  try {
    const { object } = await generateObject({
      model: createModel('gemini'),
      schema: NarrativeSchema,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.4,
      maxRetries: 0,
    });

    const payload = { ...object, model: 'gemini-2.5-flash', cached: false };
    CACHE.set(id, { hash: dataHash, expires_at: Date.now() + TTL_MS, payload });
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({
      error: 'llm_generation_failed',
      message: e instanceof Error ? e.message : String(e),
    }, { status: 502 });
  }
}
