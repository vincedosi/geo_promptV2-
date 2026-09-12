/**
 * @file lib/campaigns/campagne-active.ts — dérivation de la campagne active
 * de l'overlay MAGELIAN (Tâche 9).
 *
 * Fonction PURE, extraite du composant après le round de correction 1 :
 * un test verrouille désormais la règle « la campagne active reste active
 * au retour à la carte » (rien dans cette fonction, ni dans son appelant,
 * ne doit dépendre de `open`/`closeOverlay`) et le cas piège
 * `campaigns === null` — la liste pas encore chargée ne doit RENDRE null
 * que faute de pouvoir résoudre un nom/annonceur, jamais planter.
 */
import type { MagelianTab } from '@/components/magelian/deep-link';

/** Forme minimale suffisante pour dériver `CampagneActive` — `CampaignRef`
 *  (MagelianOverlay.tsx) et tout type compatible structurellement conviennent. */
export interface CampagneRefLike {
  id: string;
  name: string;
  advertiser: string | null;
}

export interface CampagneActive {
  id: string;
  nom: string;
  annonceur: string | null;
}

/**
 * Pour cet onglet, cet identifiant de création (Stratégie), cet identifiant
 * sélectionné (Suivi/Aperçu) et cette liste de campagnes déjà chargée,
 * quelle est la campagne active ?
 *
 * - Stratégie suit `creationCampaignId` ; Suivi/Aperçu suivent `selectedId`.
 * - Sans id pertinent pour l'onglet courant, ou id absent de `campaigns`,
 *   ou `campaigns` encore `null` (liste pas chargée) : `null`.
 */
export function deriveCampagneActive(
  tab: MagelianTab,
  creationCampaignId: string | null,
  selectedId: string | null,
  campaigns: readonly CampagneRefLike[] | null,
): CampagneActive | null {
  const id = tab === 'strategie' ? creationCampaignId : selectedId;
  if (!id || !campaigns) return null;
  const trouvee = campaigns.find((c) => c.id === id);
  return trouvee ? { id: trouvee.id, nom: trouvee.name, annonceur: trouvee.advertiser } : null;
}
