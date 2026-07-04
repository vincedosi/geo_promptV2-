/** Constantes de la démo — source unique, tunables. */
export const DEMO_SEED = 42;
export const PERIOD_LEN_DAYS = 30;
export const CALENDAR_START = '2026-01-01';
export const TOTAL_VOLUME = 5_000_000;
export const SIM_GAIN = 3;
export const SIM_NOISE = 0.1;

export const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001'; // GENESIS (Global)
export const DEMO_ZONE_ID = 'f001b479-b870-4958-978d-e7a98b90de57'; // CIRFA BRETAGNE (existe)
export const DEMO_ZONE_NAME = 'CIRFA BRETAGNE';
export const DEMO_CAMPAIGN_ID = 'dede0000-0000-4000-8000-000000000001';

/** Seuil d'écart moyen (points) sous lequel la boucle est considérée « conforme ». */
export const CONVERGENCE_TOLERANCE = 2;

/** Bornes date d'une période (1-based) du calendrier synthétique. */
export function periodBounds(period: number): { start: string; end: string } {
  const base = new Date(`${CALENDAR_START}T00:00:00Z`);
  const start = new Date(base); start.setUTCDate(base.getUTCDate() + (period - 1) * PERIOD_LEN_DAYS);
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + PERIOD_LEN_DAYS);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
