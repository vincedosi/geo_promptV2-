/**
 * Carte de dérive — types du payload des RPC get_campaign_derive_* (sql/117-118)
 * et helpers purs (ton par seuil de décrochage, décompte, libellés de maille).
 * Aucune dépendance React (testable Vitest).
 */
export { parseActorsParam, actorsKey } from './actor-metrics';

export type DeriveMesh = 'national' | 'region' | 'departement' | 'cp';
export type DeriveMetric = 'hold' | 'objectif';
export type DeriveTone = 'bad' | 'warn' | 'ok' | 'over';

export interface DeriveFeature {
  code: string; nom: string | null; in_target: boolean;
  value: number | null; geometry: GeoJSON.Geometry;
}
export interface DeriveRow {
  code: string; nom: string | null; in_target: boolean;
  value: number | null; impressions: number;
}

const MESHES: DeriveMesh[] = ['national', 'region', 'departement', 'cp'];

/** Ton divergent : le seuil déplace la frontière « décroche » (rouge). */
export function decrocheTone(value: number | null, threshold: number): DeriveTone {
  if (value == null) return 'warn';
  if (value < threshold) return 'bad';
  if (value < 100) return 'warn';
  if (value <= 110) return 'ok';
  return 'over';
}

export function countDecroche(rows: { value: number | null }[], threshold: number): number {
  return rows.filter((r) => r.value != null && r.value < threshold).length;
}

export function meshLabel(m: DeriveMesh): string {
  return m === 'national' ? 'National' : m === 'region' ? 'Région'
    : m === 'departement' ? 'Département' : 'CP';
}

export function nextMesh(m: DeriveMesh): DeriveMesh {
  return MESHES[Math.min(MESHES.length - 1, MESHES.indexOf(m) + 1)];
}

export function prevMesh(m: DeriveMesh): DeriveMesh {
  return MESHES[Math.max(0, MESHES.indexOf(m) - 1)];
}

export const MESH_ORDER = MESHES;
