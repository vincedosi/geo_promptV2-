/**
 * Helpers d'agrégation côté client pour les données de comparaison "réel vs simulé"
 * renvoyées par la RPC get_strategy_comparison_data.
 *
 * Toutes les fonctions sont pures et opèrent sur les rows brutes — la RPC peut
 * retourner les NUMERIC en string (PostgREST), donc on coerce systématiquement.
 */

export interface ComparisonRow {
  postal_code: string;
  country_code: string;
  date: string;
  impressions_real: number | string;
  clicks_real: number | string;
  spend_real: number | string;
  leads_real: number | string;
  bid_multiplier: number | string;
  impressions_sim: number | string;
  clicks_sim: number | string;
  spend_sim: number | string;
  leads_sim: number | string;
}

export interface DailyComparison {
  date: string;
  impressions_real: number; impressions_sim: number;
  clicks_real: number; clicks_sim: number;
  spend_real: number; spend_sim: number;
  leads_real: number; leads_sim: number;
  cpl_real: number; cpl_sim: number;
  lift_pct: number;
  n_zones: number;
}

export interface ZoneComparison {
  postal_code: string;
  country_code: string;
  bid_multiplier: number;
  impressions_real: number; impressions_sim: number;
  clicks_real: number; clicks_sim: number;
  spend_real: number; spend_sim: number;
  leads_real: number; leads_sim: number;
  cpl_real: number; cpl_sim: number;
  lift_pct: number;
}

export interface GlobalKpis {
  total_leads_real: number;
  total_leads_sim: number;
  total_spend_real: number;
  total_spend_sim: number;
  total_impressions_real: number;
  total_impressions_sim: number;
  cpl_real: number;
  cpl_sim: number;
  cpl_delta_eur: number;
  lift_pct: number;
  leads_delta: number;
  n_zones: number;
  n_days: number;
}

const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
};

const safeRate = (a: number, b: number): number => (b > 0 ? a / b : 0);

const liftPct = (real: number, sim: number): number =>
  real > 0 ? ((sim - real) / real) * 100 : 0;

export function aggregateByDate(rows: ComparisonRow[]): DailyComparison[] {
  const byDate = new Map<string, DailyComparison>();
  const cpsByDate = new Map<string, Set<string>>();
  for (const r of rows) {
    const acc = byDate.get(r.date) ?? {
      date: r.date,
      impressions_real: 0, impressions_sim: 0,
      clicks_real: 0, clicks_sim: 0,
      spend_real: 0, spend_sim: 0,
      leads_real: 0, leads_sim: 0,
      cpl_real: 0, cpl_sim: 0, lift_pct: 0, n_zones: 0,
    };
    acc.impressions_real += num(r.impressions_real);
    acc.impressions_sim += num(r.impressions_sim);
    acc.clicks_real += num(r.clicks_real);
    acc.clicks_sim += num(r.clicks_sim);
    acc.spend_real += num(r.spend_real);
    acc.spend_sim += num(r.spend_sim);
    acc.leads_real += num(r.leads_real);
    acc.leads_sim += num(r.leads_sim);
    byDate.set(r.date, acc);
    if (!cpsByDate.has(r.date)) cpsByDate.set(r.date, new Set());
    cpsByDate.get(r.date)!.add(r.postal_code);
  }
  const out: DailyComparison[] = [];
  for (const [d, acc] of byDate) {
    acc.cpl_real = safeRate(acc.spend_real, acc.leads_real);
    acc.cpl_sim = safeRate(acc.spend_sim, acc.leads_sim);
    acc.lift_pct = liftPct(acc.leads_real, acc.leads_sim);
    acc.n_zones = cpsByDate.get(d)?.size ?? 0;
    out.push(acc);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function aggregateByZone(rows: ComparisonRow[]): ZoneComparison[] {
  const byZone = new Map<string, ZoneComparison>();
  for (const r of rows) {
    const key = `${r.postal_code}__${r.country_code}`;
    const acc = byZone.get(key) ?? {
      postal_code: r.postal_code,
      country_code: r.country_code,
      bid_multiplier: num(r.bid_multiplier),
      impressions_real: 0, impressions_sim: 0,
      clicks_real: 0, clicks_sim: 0,
      spend_real: 0, spend_sim: 0,
      leads_real: 0, leads_sim: 0,
      cpl_real: 0, cpl_sim: 0, lift_pct: 0,
    };
    acc.impressions_real += num(r.impressions_real);
    acc.impressions_sim += num(r.impressions_sim);
    acc.clicks_real += num(r.clicks_real);
    acc.clicks_sim += num(r.clicks_sim);
    acc.spend_real += num(r.spend_real);
    acc.spend_sim += num(r.spend_sim);
    acc.leads_real += num(r.leads_real);
    acc.leads_sim += num(r.leads_sim);
    byZone.set(key, acc);
  }
  const out: ZoneComparison[] = [];
  for (const acc of byZone.values()) {
    acc.cpl_real = safeRate(acc.spend_real, acc.leads_real);
    acc.cpl_sim = safeRate(acc.spend_sim, acc.leads_sim);
    acc.lift_pct = liftPct(acc.leads_real, acc.leads_sim);
    out.push(acc);
  }
  out.sort((a, b) => b.leads_sim - a.leads_sim);
  return out;
}

export function computeGlobalKpis(rows: ComparisonRow[]): GlobalKpis {
  const acc: GlobalKpis = {
    total_leads_real: 0, total_leads_sim: 0,
    total_spend_real: 0, total_spend_sim: 0,
    total_impressions_real: 0, total_impressions_sim: 0,
    cpl_real: 0, cpl_sim: 0, cpl_delta_eur: 0,
    lift_pct: 0, leads_delta: 0,
    n_zones: 0, n_days: 0,
  };
  const zones = new Set<string>();
  const days = new Set<string>();
  for (const r of rows) {
    acc.total_leads_real += num(r.leads_real);
    acc.total_leads_sim += num(r.leads_sim);
    acc.total_spend_real += num(r.spend_real);
    acc.total_spend_sim += num(r.spend_sim);
    acc.total_impressions_real += num(r.impressions_real);
    acc.total_impressions_sim += num(r.impressions_sim);
    zones.add(`${r.postal_code}__${r.country_code}`);
    days.add(r.date);
  }
  acc.cpl_real = safeRate(acc.total_spend_real, acc.total_leads_real);
  acc.cpl_sim = safeRate(acc.total_spend_sim, acc.total_leads_sim);
  acc.cpl_delta_eur = acc.cpl_sim - acc.cpl_real;
  acc.lift_pct = liftPct(acc.total_leads_real, acc.total_leads_sim);
  acc.leads_delta = acc.total_leads_sim - acc.total_leads_real;
  acc.n_zones = zones.size;
  acc.n_days = days.size;
  return acc;
}
