/**
 * Logique pure du plan média zones custom (ZoneMediaPlanPanel).
 * Extraite pour être testée unitairement — le scénario multi-zones (4 CIRFA)
 * n'est pas toujours reproductible en environnement de dev.
 */

/**
 * Modifie la part d'une zone et réajuste les autres proportionnellement pour
 * que la somme reste à 100. Cas limites :
 *   - une seule zone → verrouillée à 100 ;
 *   - autres zones toutes à 0 → le reliquat est réparti à parts égales.
 */
export function normalizeShares(
  current: Record<string, number>,
  zoneId: string,
  valueRaw: number,
  zoneIds: string[],
): Record<string, number> {
  const others = zoneIds.filter(id => id !== zoneId);
  if (!others.length) return { [zoneId]: 100 };

  const value = Math.min(100, Math.max(0, valueRaw));
  const othersSum = others.reduce((acc, id) => acc + (current[id] ?? 0), 0);
  const remaining = 100 - value;
  const next: Record<string, number> = { [zoneId]: value };
  for (const id of others) {
    next[id] = othersSum > 0
      ? ((current[id] ?? 0) / othersSum) * remaining
      : remaining / others.length;
  }
  return next;
}

/** Répartition au prorata d'un volume par zone (somme = 100 ; volumes nuls → parts égales). */
export function proportionalShares(
  volumes: Array<{ id: string; volume: number | null }>,
): Record<string, number> {
  const total = volumes.reduce((acc, v) => acc + (v.volume ?? 0), 0);
  const out: Record<string, number> = {};
  for (const v of volumes) {
    out[v.id] = total > 0
      ? ((v.volume ?? 0) / total) * 100
      : (volumes.length ? 100 / volumes.length : 0);
  }
  return out;
}
