/**
 * Partition des campagnes pour l'overlay MAGELIAN (spec 2026-07-17) :
 * - consultables : Suivi/Aperçu — la campagne a des données OU une stratégie ;
 * - shells : hall Création « Reprendre » — nées du wizard (magelian) sans
 *   stratégie, MÊME si elles ont déjà absorbé un import (création en cours) ;
 * - launched : hall Création « Modifier » — toute campagne avec stratégie.
 * Une campagne peut apparaître des deux côtés (consultable ET reprenable) :
 * deux intentions différentes sur le même objet.
 */
import { MAGELIAN_SOURCE } from './blank-campaign';

export interface OverlayCampaign {
  id: string;
  name: string;
  dsp_source: string | null;
  total_tracked_ads: number | null;
}

export interface OverlayPartition<T extends OverlayCampaign> {
  consultables: T[];
  shells: T[];
  launched: T[];
}

export function partitionCampaigns<T extends OverlayCampaign>(
  campaigns: T[],
  strategyCampaignIds: ReadonlySet<string>,
): OverlayPartition<T> {
  const hasData = (c: OverlayCampaign) => (c.total_tracked_ads ?? 0) > 0;
  const hasStrategy = (c: OverlayCampaign) => strategyCampaignIds.has(c.id);
  return {
    consultables: campaigns.filter((c) => hasData(c) || hasStrategy(c)),
    shells: campaigns.filter((c) => c.dsp_source === MAGELIAN_SOURCE && !hasStrategy(c)),
    launched: campaigns.filter(hasStrategy),
  };
}
