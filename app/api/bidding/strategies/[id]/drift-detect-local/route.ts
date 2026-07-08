/**
 * POST /api/bidding/strategies/[id]/drift-detect-local
 *
 * Détection de drift côté Node (Page-Hinkley) sans dépendance au service ML
 * externe. Calcule pour chaque zone la déviation cumulée (real_t - sim_t)
 * sur les N derniers jours, et déclenche un drift event si dépassement
 * du seuil λ.
 *
 * Persiste les events dans bidding_drift_events avec severity calculée.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';
import { type ComparisonRow } from '@/lib/bidding-ml/comparison';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface DriftCandidate {
  postal_code: string;
  ph_value: number;        // valeur du test Page-Hinkley
  cumulated_diff: number;  // déviation cumulée
  severity: 'low' | 'medium' | 'high' | 'critical';
  n_days: number;
}

/**
 * Page-Hinkley test sur la série (real_t - sim_t).
 * Renvoie la valeur PH max et la déviation cumulée.
 */
function pageHinkley(series: number[], delta = 0.005): { ph_max: number; cumDiff: number } {
  if (series.length === 0) return { ph_max: 0, cumDiff: 0 };
  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  let cumDiff = 0;
  let minSum = 0;
  let maxPh = 0;
  for (const v of series) {
    cumDiff += v - mean - delta;
    if (cumDiff < minSum) minSum = cumDiff;
    const ph = cumDiff - minSum;
    if (ph > maxPh) maxPh = ph;
  }
  return { ph_max: maxPh, cumDiff: series.reduce((s, v) => s + v, 0) };
}

function severityFromPh(ph: number, lambda: number): 'low' | 'medium' | 'high' | 'critical' {
  if (ph < lambda) return 'low';
  if (ph < lambda * 2) return 'medium';
  if (ph < lambda * 4) return 'high';
  return 'critical';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;

  let body: { lookback_days?: number; lambda?: number; metric?: 'impressions' | 'clicks' | 'leads' };
  try { body = await request.json(); } catch { body = {}; }
  const lookback = body.lookback_days ?? 14;
  const metric = body.metric ?? 'impressions';
  const fields = metric === 'impressions' ? { real: 'impressions_real', sim: 'impressions_sim' }
    : metric === 'clicks' ? { real: 'clicks_real', sim: 'clicks_sim' }
    : { real: 'leads_real', sim: 'leads_sim' };

  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  // Charge comparison data
  const { data: rows, error } = await supabase.rpc('get_strategy_comparison_data', {
    p_strategy_id: id,
    p_date_from: null,
    p_date_to: null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const allRows = (rows ?? []) as ComparisonRow[];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookback);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const recent = allRows.filter(r => r.date >= cutoffIso);

  // Group by postal_code
  const byZone = new Map<string, ComparisonRow[]>();
  for (const r of recent) {
    if (!byZone.has(r.postal_code)) byZone.set(r.postal_code, []);
    byZone.get(r.postal_code)!.push(r);
  }

  const lambda = body.lambda ?? 5; // seuil par défaut, tuneable
  const candidates: DriftCandidate[] = [];

  for (const [cp, zoneRows] of byZone) {
    const sorted = [...zoneRows].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 4) continue; // trop peu de points
    const series = sorted.map(r => Number((r as unknown as Record<string, unknown>)[fields.real]) - Number((r as unknown as Record<string, unknown>)[fields.sim]));
    const norm = Math.max(1, sorted.reduce((s, r) => s + Number((r as unknown as Record<string, unknown>)[fields.sim]), 0) / sorted.length);
    const normalized = series.map(v => v / norm);
    const { ph_max, cumDiff } = pageHinkley(normalized, 0.005);
    if (ph_max >= lambda * 0.01) {
      candidates.push({
        postal_code: cp,
        ph_value: ph_max,
        cumulated_diff: cumDiff,
        severity: severityFromPh(ph_max, lambda * 0.01),
        n_days: sorted.length,
      });
    }
  }

  // Persistance dans bidding_drift_events (best-effort)
  const inserted: string[] = [];
  for (const c of candidates) {
    try {
      const { error: insErr } = await supabase.from('bidding_drift_events').insert({
        strategy_id: id,
        postal_code: c.postal_code,
        severity: c.severity,
        detected_at: new Date().toISOString(),
        details: {
          method: 'page_hinkley_local',
          ph_value: c.ph_value,
          cumulated_diff: c.cumulated_diff,
          n_days: c.n_days,
          metric,
          lambda,
        },
      });
      if (!insErr) inserted.push(c.postal_code);
    } catch { /* best-effort */ }
  }

  return NextResponse.json({
    method: 'page_hinkley_local',
    lookback_days: lookback,
    metric,
    lambda,
    n_candidates: candidates.length,
    n_persisted: inserted.length,
    candidates: candidates.sort((a, b) => b.ph_value - a.ph_value),
  });
}
