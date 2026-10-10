import { FAMILLES_ICPE_SEED, NATURE_NON_PRECISEE } from './familles-icpe';
import { type TypeRisque, librellesDuType } from './types-risque';

/**
 * Les libellés de nature que `/api/map/risques-industriels` attend pour des types de risque choisis
 * (`RisqueIndustrielLayer.tsx:263-269`) : `librellesDuType` sur le seed des familles — la MÊME fonction que la légende,
 * pour qu'un point filtré « toxique » soit bien celui peint en toxique —, plus « Nature non précisée » quand
 * `non_precise` est retenu (l'absence de rubrique exploitable n'a pas de libellé de famille).
 */
export function naturesDesTypes(types: readonly string[]): string[] {
  const natures = types.flatMap((t) => librellesDuType(t as TypeRisque, FAMILLES_ICPE_SEED));
  if (types.includes('non_precise')) natures.push(NATURE_NON_PRECISEE);
  return natures;
}
