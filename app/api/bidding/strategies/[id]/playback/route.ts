/**
 * GET /api/bidding/strategies/[id]/playback
 *
 * Renvoie les agrégats journaliers (total leads/spend réel vs simulé)
 * pour le bouton play et la timeline. Optimisé pour 30 lignes max.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface ComparisonRow {
  postal_code: string;
  country_code: string;
  date: string;
  impressions_real: number;
  clicks_real: number;
  spend_real: number | string;
  leads_real: number;
  bid_multiplier: number | string;
  impressions_sim: number;
  clicks_sim: number;
  spend_sim: number | string;
  leads_sim: number;
}

interface DailyAgg {
  date: string;
  impressions_real: number;
  clicks_real: number;
  spend_real: number;
  leads_real: number;
  impressions_sim: number;
  clicks_sim: number;
  spend_sim: number;
  leads_sim: number;
  cpl_real: number;
  cpl_sim: number;
  lift_pct: number;
  n_zones: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_strategy_comparison_data', {
    p_strategy_id: id,
    p_date_from: null,
    p_date_to: null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ComparisonRow[];
  const byDate = new Map<string, DailyAgg>();
  const cpsByDate = new Map<string, Set<string>>();
  for (const r of rows) {
    const d = r.date;
    const acc = byDate.get(d) ?? {
      date: d,
      impressions_real: 0, clicks_real: 0, spend_real: 0, leads_real: 0,
      impressions_sim: 0, clicks_sim: 0, spend_sim: 0, leads_sim: 0,
      cpl_real: 0, cpl_sim: 0, lift_pct: 0, n_zones: 0,
    };
    acc.impressions_real += Number(r.impressions_real) || 0;
    acc.clicks_real += Number(r.clicks_real) || 0;
    acc.spend_real += Number(r.spend_real) || 0;
    acc.leads_real += Number(r.leads_real) || 0;
    acc.impressions_sim += Number(r.impressions_sim) || 0;
    acc.clicks_sim += Number(r.clicks_sim) || 0;
    acc.spend_sim += Number(r.spend_sim) || 0;
    acc.leads_sim += Number(r.leads_sim) || 0;
    byDate.set(d, acc);
    if (!cpsByDate.has(d)) cpsByDate.set(d, new Set());
    cpsByDate.get(d)!.add(r.postal_code);
  }
  const series: DailyAgg[] = [];
  for (const [d, agg] of byDate) {
    agg.cpl_real = agg.leads_real > 0 ? agg.spend_real / agg.leads_real : 0;
    agg.cpl_sim = agg.leads_sim > 0 ? agg.spend_sim / agg.leads_sim : 0;
    agg.lift_pct = agg.leads_real > 0
      ? ((agg.leads_sim - agg.leads_real) / agg.leads_real) * 100
      : 0;
    agg.n_zones = cpsByDate.get(d)?.size ?? 0;
    series.push(agg);
  }
  series.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ daily: series });
}
