/**
 * Vue par acteur — types du payload de get_campaign_actors (sql/113) et helpers
 * purs. Aucune dépendance React (testable Vitest). Formats réutilisés de
 * suivi-metrics (DRY).
 */
export { fmtInt, fmtCpm, fmtPct, toneColor } from './suivi-metrics';

export type ActorKind = 'dsp' | 'social' | 'régie';

export interface ActorRow {
  actor: string;
  kind: ActorKind;
  impressions: number;
  spend: number;
  cpm: number | null;
  share_pct: number | null;
  objective_attainment: number | null;
}

export interface ActorsPayload {
  objective_pct: number | null;
  actors: ActorRow[];
}

export function actorKindLabel(kind: ActorKind): string {
  if (kind === 'dsp') return 'DSP';
  if (kind === 'social') return 'Social';
  return 'Régie';
}

export function actorDisplayName(actor: string): string {
  return actor.trim() === '' ? 'Non attribué' : actor;
}
