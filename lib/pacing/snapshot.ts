/**
 * Construction du snapshot de plan par zone — logique pure (zéro I/O, testable).
 * Corrige un bug de normalisation : les items non expansables (0 CP) doivent être
 * EXCLUS avant de calculer expected_share, pas après. Sinon Σ expected_share < 1
 * dans la zone, ce qui casse l'invariant lu par lib/pacing/compute.ts (actual_share
 * normalisé sur 1 intra-zone) → faux "sur-servi" systématique sur les items restants.
 */

export interface PlanItemInput {
  item_id: string;
  item_name: string;
  weight: number;
}

export interface SnapshotItemRow {
  item_id: string;
  item_name: string;
  item_weight: number;
  expected_share: number;
  cps: string[];
}

/**
 * Construit les lignes de snapshot d'UNE zone : ne retient que les items
 * effectivement expansables (au moins 1 CP), et normalise expected_share
 * sur la somme des poids des SEULS items retenus (→ Σ expected_share = 1 par zone,
 * ou tableau vide si aucun item retenu).
 * @param zoneId    pour extraire poi_id depuis item_id = `${zoneId}:${poiId}`
 * @param planItems items du plan tels que saisis par l'utilisateur (poids incluant les non-expansables)
 * @param cpsByPoi  map poi_id → codes postaux (issue de get_zone_items_export)
 */
export function buildZoneSnapshotItems(
  zoneId: string,
  planItems: PlanItemInput[],
  cpsByPoi: Map<string, string[]>,
): SnapshotItemRow[] {
  const kept = planItems
    .map(pi => ({ pi, cps: cpsByPoi.get(pi.item_id.slice(zoneId.length + 1)) ?? [] }))
    .filter(x => x.cps.length > 0);
  const totalWeight = kept.reduce((s, x) => s + x.pi.weight, 0) || 1;
  return kept.map(({ pi, cps }) => ({
    item_id: pi.item_id,
    item_name: pi.item_name,
    item_weight: pi.weight,
    expected_share: pi.weight / totalWeight,
    cps,
  }));
}
