/**
 * Sélection du reporter par canal + exécution avec catch → failed.
 *   connexion + connecteur → réel (api/skipped selon le connecteur)
 *   sinon                  → skipped (connecte un DSP pour réconcilier)
 * La démo NE passe PAS ici : elle est générée en SQL (simulate_dsp_report).
 */
import { dv360Reporter } from './dv360';
import type { DspReportContext, DspReportResult, DspReporter } from './types';

const REAL_REPORTERS: Record<string, DspReporter> = { dv360: dv360Reporter };

function skippedReporter(channel: string, detail: string): DspReporter {
  return { channel, async report() { return { channel, status: 'skipped', rows: [], detail }; } };
}

export function selectReporter(channel: string, hasConnection: boolean): DspReporter {
  if (!hasConnection) return skippedReporter(channel, 'Canal non connecté — connecte un DSP pour réconcilier');
  return REAL_REPORTERS[channel] ?? skippedReporter(channel, `Reporter ${channel} non implémenté`);
}

export async function runReport(ctx: DspReportContext): Promise<DspReportResult> {
  const reporter = selectReporter(ctx.channel, ctx.hasConnection);
  try {
    return await reporter.report(ctx);
  } catch (e) {
    return {
      channel: ctx.channel, status: 'failed', rows: [],
      detail: e instanceof Error ? e.message.slice(0, 300) : 'Erreur inconnue',
    };
  }
}

export type { DspReportContext, DspReportResult, DspReportRow, DspReporter } from './types';
