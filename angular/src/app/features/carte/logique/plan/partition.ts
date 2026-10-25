/**
 * ⑥ Plan — la PARTITION du hall (lot 6, revue finale, F-5), copiée de `partitionCampaigns`
 * (`lib/campaigns/overlay-partition.ts`) et réduite aux deux listes du hall de création :
 * - « Reprendre une création » (`shells`) : les coquilles nées dans l'application (`dsp_source` = `magelian`) SANS
 *   stratégie, même si elles ont déjà reçu un import ;
 * - « Modifier une campagne lancée » (`launched`) : toute campagne qui a une stratégie.
 * Une campagne peut figurer des deux côtés de l'overlay React (consultable ET reprenable) ; `consultables` (Suivi,
 * Aperçu) n'est pas porté ici. Verrouillée par `tests/unit/angular/plan-logique-paritaire.test.ts`.
 */

/** La source des campagnes nées dans l'application, sans import DSP (`MAGELIAN_SOURCE`, `lib/campaigns/blank-campaign.ts`). */
export const SOURCE_COQUILLE = 'magelian';

export interface CampagnePartitionnee {
  id: string;
  dsp_source: string | null;
}

export interface PartitionHall<T extends CampagnePartitionnee> {
  shells: T[];
  launched: T[];
}

export function partitionHall<T extends CampagnePartitionnee>(campagnes: readonly T[], avecStrategie: ReadonlySet<string>): PartitionHall<T> {
  return {
    shells: campagnes.filter((c) => c.dsp_source === SOURCE_COQUILLE && !avecStrategie.has(c.id)),
    launched: campagnes.filter((c) => avecStrategie.has(c.id)),
  };
}
