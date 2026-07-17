/**
 * Cockpit de suivi — types du payload de `get_campaign_suivi` (sql/108) et
 * helpers purs (tons de couleur, formats fr-FR). Aucune dépendance React :
 * tout est testable en Vitest pur.
 *
 * Seuils de ton (miroir des alertes serveur, mais indépendants — le serveur
 * décide des alertes, le client ne fait que colorer) :
 *   pacing  : ok 0,90–1,10 · warn 0,75–0,90 / 1,10–1,25 · bad ailleurs ;
 *   cpm     : ok ≤ prévu ×1,10 · warn ≤ ×1,25 · bad au-delà ;
 *   hold    : ok ≥ 80 · warn 60–80 · bad < 60.
 */

export type SuiviTone = 'ok' | 'warn' | 'bad';

export interface SuiviAlert {
  kind: 'pacing' | 'cpm' | 'zones_under' | 'leak';
  severity: 'warning' | 'danger';
  title: string;
  detail: string;
}

export interface SuiviLevel1Row {
  zone: 'cible' | 'hors_cible';
  impressions: number;
  share_real: number | null;
  share_plan: number | null;
  cpm: number | null;
  spend: number;
}

export interface SuiviDeptRow {
  dept: string;
  in_target: boolean;
  impressions: number;
  hold_index: number | null;
  cpm: number | null;
  spend: number;
  delta7_pct: number | null;
}

export interface SuiviCpRow {
  postal_code: string;
  in_target: boolean;
  impressions: number;
  hold_index: number | null;
  cpm: number | null;
  spend: number;
  delta7_pct: number | null;
}

export interface SuiviDaily {
  date: string;
  impressions: number;
  spend: number;
  cpm: number | null;
}

export interface SuiviMedia {
  media: string;
  impressions: number;
  spend: number;
  cpm: number | null;
}

export interface SuiviPayload {
  as_of: string;
  start_date: string | null;
  end_date: string | null;
  pacing: {
    spend: number;
    total_budget: number | null;
    budget_pct: number | null;
    time_pct: number | null;
    index: number | null;
  };
  cpm: { real: number | null; forecast: number | null; delta_pct: number | null };
  pressure: {
    mode: string;
    requested: number | null;
    obtained: number | null;
    in_target_share: number | null;
    out_share: number | null;
  };
  objective: {
    code: string | null;
    basis: 'kpi' | 'forecast' | null;
    kpi_target: number | null;
    realized: number;
    expected: number;
    pct: number | null;
  };
  alerts: SuiviAlert[];
  level1: SuiviLevel1Row[];
  depts: SuiviDeptRow[];
  daily: SuiviDaily[];
  medias: SuiviMedia[];
}

export function pacingTone(index: number | null): SuiviTone {
  if (index == null) return 'warn';
  if (index >= 0.9 && index <= 1.1) return 'ok';
  if ((index >= 0.75 && index < 0.9) || (index > 1.1 && index <= 1.25)) return 'warn';
  return 'bad';
}

export function cpmTone(real: number | null, forecast: number | null): SuiviTone {
  if (real == null || forecast == null || forecast <= 0) return 'ok';
  if (real <= forecast * 1.1) return 'ok';
  if (real <= forecast * 1.25) return 'warn';
  return 'bad';
}

export function holdTone(index: number | null): SuiviTone {
  if (index == null) return 'warn';
  if (index >= 80) return 'ok';
  if (index >= 60) return 'warn';
  return 'bad';
}

export function toneColor(tone: SuiviTone): string {
  if (tone === 'ok') return 'var(--success)';
  if (tone === 'warn') return 'var(--warning)';
  return 'var(--danger)';
}

/** toLocaleString fr-FR émet des espaces insécables (U+202F/U+00A0) selon
 *  l'ICU — normalisés en espaces simples pour un rendu/test déterministe. */
function frNumber(v: number, opts?: Intl.NumberFormatOptions): string {
  return v.toLocaleString('fr-FR', opts).replace(/[  ]/g, ' ');
}

export function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${frNumber(v)} %`;
}

export function fmtCpm(v: number | null): string {
  if (v == null) return '—';
  return `${frNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export function fmtInt(v: number | null): string {
  if (v == null) return '—';
  return frNumber(Math.round(v));
}
