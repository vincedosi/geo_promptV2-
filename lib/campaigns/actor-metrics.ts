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

/**
 * Parse le paramètre `?actors=` d'une requête suivi (owner unique de l'invariant
 * consommé par les RPC). Vide/blanc ⇒ `null` (« tous »), JAMAIS `[]` — que le
 * SQL `actor = ANY(p_actors)` lit comme « aucun acteur » → payload vide.
 */
export function parseActorsParam(sp: URLSearchParams): string[] | null {
  const raw = sp.get('actors');
  const list = raw ? raw.split(',').map((a) => a.trim()).filter(Boolean) : [];
  return list.length ? list : null;
}

/** Clé de cache stable pour un jeu d'acteurs (ordre indifférent). */
export function actorsKey(actors: string[]): string {
  return [...actors].sort().join(',');
}

/** true si la sélection couvre tous les acteurs ([] = tous, ou la liste complète). */
export function isAllActors(selected: string[], total: number): boolean {
  return selected.length === 0 || selected.length === total;
}
