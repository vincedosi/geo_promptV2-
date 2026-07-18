/**
 * Reporter DV360 (Bid Manager reporting API). Structure posée ; renvoie
 * `skipped` tant que les droits Google ne sont pas débloqués — exactement
 * comme le push. Point d'ancrage de l'appel réel : voir TODO ci-dessous.
 */
import type { DspReporter, DspReportResult } from './types';

export const dv360Reporter: DspReporter = {
  channel: 'dv360',
  async report(): Promise<DspReportResult> {
    // TODO: brancher DV360 Bid Manager reporting API quand les droits Google
    // sont débloqués (créer un query, récupérer le rapport CSV, mapper en
    // DspReportRow date×channel×CP). Jusque-là : skipped honnête.
    return {
      channel: 'dv360',
      status: 'skipped',
      rows: [],
      detail: 'Reporting DV360 — droits Google en attente (push manuel via export en attendant)',
    };
  },
};
