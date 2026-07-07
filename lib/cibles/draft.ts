/** Zones cibles — manipulation pure du panier de cibles du brouillon wizard. */
export interface CibleZoneRef { id: string; name: string; sourceType: string }

export function addCible(list: CibleZoneRef[], ref: CibleZoneRef): CibleZoneRef[] {
  return list.some((c) => c.id === ref.id) ? list : [...list, ref];
}
export function removeCible(list: CibleZoneRef[], id: string): CibleZoneRef[] {
  return list.filter((c) => c.id !== id);
}
export function cibleScope(list: CibleZoneRef[]): { scope_type: 'national' | 'custom_zone' } {
  return { scope_type: list.length ? 'custom_zone' : 'national' };
}
