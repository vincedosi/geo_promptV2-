/**
 * MAGELIAN — construction du bilan de campagne.
 *
 * Agrege les snapshots de versions successives d'une strategie en un
 * CampaignReport : courbe de convergence, comparatif avant/apres par zone,
 * synthese budgetaire et KPIs. Consomme le pacing calcule par
 * lib/pacing/compute et la tolerance de convergence de lib/demo/constants.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computePacing, type PacingItemInput } from '@/lib/pacing/compute';
import { CONVERGENCE_TOLERANCE } from '@/lib/demo/constants';
import type {
  SnapshotMeta, RawVersionPacing, CampaignReport,
  ConvergencePoint, ZoneBeforeAfter, BudgetSummary, ReportKpis,
} from '@/lib/report/types';

const round = (n: number, d: number) => { const f = 10 ** d; return Math.round(n * f) / f; };

/** Dépense d'une version : Σ actual_spend ; sinon fallback déterministe Σ actual_imp × cpm / 1000. */
function versionSpend(items: PacingItemInput[], cpm: number): number {
  const spend = items.reduce((s, it) => s + (it.actual_spend ?? 0), 0);
  if (spend > 0) return spend;
  const imp = items.reduce((s, it) => s + (it.actual_imp ?? 0), 0);
  return (imp * cpm) / 1000;
}

/** Assemble le CampaignReport à partir des données déjà lues (PUR, testable). */
export function assembleReport(
  campaignId: string, campaignName: string, meta: SnapshotMeta[], pacings: RawVersionPacing[],
): CampaignReport | null {
  if (meta.length === 0 || pacings.length === 0) return null;

  const metaByV = new Map(meta.map((m) => [m.version, m]));
  const computedByV = new Map(pacings.map((p) => [p.version, computePacing(p.items)]));
  const pacingByV = new Map(pacings.map((p) => [p.version, p]));

  const versions = pacings.map((p) => p.version).sort((a, b) => a - b);
  const firstV = versions[0];
  const lastV = versions[versions.length - 1];

  const convergence: ConvergencePoint[] = versions.map((v) => {
    const items = computedByV.get(v) ?? [];
    const mean = items.length ? items.reduce((s, it) => s + Math.abs(it.delta_pts), 0) / items.length : 0;
    const mean_delta = round(mean, 2);
    return { version: v, mean_delta, converged: mean_delta < CONVERGENCE_TOLERANCE };
  });

  const firstItems = computedByV.get(firstV) ?? [];
  const lastById = new Map((computedByV.get(lastV) ?? []).map((it) => [it.item_id, it]));
  const zones: ZoneBeforeAfter[] = firstItems.map((f) => {
    const l = lastById.get(f.item_id) ?? f;
    return {
      item_id: f.item_id, item_name: f.item_name,
      expected_share: f.expected_share,
      actual_share_first: f.actual_share, actual_share_last: l.actual_share,
      delta_first: round(f.delta_pts, 1), delta_last: round(l.delta_pts, 1),
      status_first: f.status, status_last: l.status,
    };
  });

  const spentByV = (v: number) => versionSpend(pacingByV.get(v)!.items, metaByV.get(v)?.cpm ?? 0);
  const planned_total = meta.reduce((s, m) => s + (m.budget ?? 0), 0);
  const spent_total = round(versions.reduce((s, v) => s + spentByV(v), 0), 2);
  const planned_last = metaByV.get(lastV)?.budget ?? 0;
  const spent_last = round(spentByV(lastV), 2);
  const in_plan_imp_total = pacings.reduce((s, p) => s + (p.in_plan_imp ?? 0), 0);
  const total_imp_total = pacings.reduce((s, p) => s + (p.total_imp ?? 0), 0);
  const spillover_imp_total = pacings.reduce((s, p) => s + (p.spillover_imp ?? 0), 0);
  const budget: BudgetSummary = {
    planned_total, spent_total,
    variance_pct: planned_total > 0 ? round(((spent_total - planned_total) / planned_total) * 100, 1) : 0,
    planned_last, spent_last,
    variance_last_pct: planned_last > 0 ? round(((spent_last - planned_last) / planned_last) * 100, 1) : 0,
    in_plan_imp_total, total_imp_total, spillover_imp_total,
    spillover_pct: total_imp_total > 0 ? round((spillover_imp_total / total_imp_total) * 100, 1) : 0,
  };

  const delta_first = convergence[0].mean_delta;
  const delta_last = convergence[convergence.length - 1].mean_delta;
  const kpis: ReportKpis = {
    corrections: versions.length - 1,
    delta_first, delta_last, improvement_pts: round(delta_first - delta_last, 2),
    converged: convergence[convergence.length - 1].converged,
    conforming_items_last: zones.filter((z) => z.status_last === 'conforme').length,
    total_items: zones.length,
  };

  const m0 = metaByV.get(firstV)!;
  const mN = metaByV.get(lastV)!;
  return {
    header: {
      campaign_id: campaignId, campaign_name: campaignName,
      zone_name: m0.zone_name, dsp: m0.dsp, cible: m0.cible,
      period_start: m0.period_start ?? '', period_end: mN.period_end ?? '',
      version_count: versions.length,
    },
    convergence, zones, budget, kpis, narrative: undefined,
  };
}

/** Lit les snapshots + le pacing par version (séquentiel, Nano) puis assemble le report. */
export async function buildCampaignReport(
  supabase: SupabaseClient, campaignId: string, metric = 'impressions',
): Promise<CampaignReport | null> {
  const { data: camp, error: campErr } = await supabase.from('dsp_campaigns').select('name').eq('id', campaignId).single();
  if (campErr) throw campErr;
  const campaignName = (camp?.name as string | undefined) ?? 'Campagne';

  const { data: rows, error: rowsErr } = await supabase.from('campaign_plan_snapshot')
    .select('version, budget, cpm, cible, dsp, zone_name, period_start, period_end')
    .eq('campaign_id', campaignId).order('version', { ascending: true });
  if (rowsErr) throw rowsErr;
  if (!rows?.length) return null;

  const metaByV = new Map<number, SnapshotMeta>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const v = Number(r.version);
    if (!metaByV.has(v)) metaByV.set(v, {
      version: v, budget: Number(r.budget ?? 0), cpm: Number(r.cpm ?? 0),
      cible: (r.cible as string) ?? '', dsp: (r.dsp as string) ?? '', zone_name: (r.zone_name as string) ?? '',
      period_start: (r.period_start as string) ?? null, period_end: (r.period_end as string) ?? null,
    });
  }
  const meta = [...metaByV.values()].sort((a, b) => a.version - b.version);

  const pacings: RawVersionPacing[] = [];
  for (const m of meta) {
    const { data, error: rpcErr } = await supabase.rpc('get_campaign_pacing', {
      p_campaign_id: campaignId, p_metric_field: metric, p_version: m.version,
    });
    if (rpcErr) throw rpcErr;
    const rpc = (typeof data === 'string' ? JSON.parse(data) : data) as
      { items?: PacingItemInput[]; in_plan_imp?: number; total_imp?: number; spillover?: { imp?: number } } | null;
    if (!rpc) continue;
    pacings.push({
      version: m.version, items: rpc.items ?? [],
      in_plan_imp: Number(rpc.in_plan_imp ?? 0), total_imp: Number(rpc.total_imp ?? 0),
      spillover_imp: Number(rpc.spillover?.imp ?? 0),
    });
  }
  return assembleReport(campaignId, campaignName, meta, pacings);
}
