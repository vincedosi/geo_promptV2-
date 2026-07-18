/**
 * Reporters DSP (pull des rapports de délivrance/coût) — miroir de lib/dsp/push.
 * Un reporter par canal, même signature. La démo est générée en SQL
 * (simulate_dsp_report), pas ici : ce module porte le chemin API réel.
 */
export type ReportStatus = 'api' | 'skipped' | 'failed';

export interface DspReportRow {
  date: string | null;      // null = grain CP
  channel: string;
  postal_code: string;      // '' = grain daily
  impressions: number;
  clicks: number;
  spend: number;
}

export interface DspReportContext {
  channel: string;
  campaign: { id: string; name: string };
  hasConnection: boolean;
  dateStart: string | null;
  dateEnd: string | null;
}

export interface DspReportResult {
  channel: string;
  status: ReportStatus;
  rows: DspReportRow[];
  detail: string;
}

export interface DspReporter {
  channel: string;
  report(ctx: DspReportContext): Promise<DspReportResult>;
}
