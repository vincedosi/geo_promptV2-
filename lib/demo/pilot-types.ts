/** Types & projection du diagnostic de pilotage — logique pure (zéro I/O). */
import type { PacingItem, PacingStatus } from '@/lib/pacing/compute';
import { CONVERGENCE_TOLERANCE } from '@/lib/demo/constants';

export interface PilotItem {
  item_id: string;
  item_name: string;
  expected_share: number;
  actual_share: number;
  delta_pts: number;
  status: PacingStatus;
}

export interface PilotPacing {
  version: number;
  mean_delta: number;
  converged: boolean;
  items: PilotItem[];
}

export interface PilotResult extends PilotPacing {
  delivery_rows: number;
}

/** Projette le pacing calculé en diagnostic de pilotage (écart moyen + convergence). */
export function toPilotPacing(
  version: number,
  items: PacingItem[],
  tol: number = CONVERGENCE_TOLERANCE,
): PilotPacing {
  const mean_delta = items.length
    ? items.reduce((s, i) => s + Math.abs(i.delta_pts), 0) / items.length
    : 0;
  return {
    version,
    mean_delta: Math.round(mean_delta * 100) / 100,
    converged: mean_delta < tol,
    items: items.map((i) => ({
      item_id: i.item_id,
      item_name: i.item_name,
      expected_share: i.expected_share,
      actual_share: i.actual_share,
      delta_pts: Math.round(i.delta_pts * 10) / 10,
      status: i.status,
    })),
  };
}
