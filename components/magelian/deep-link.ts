/** Deep-link de l'overlay MAGELIAN : /map?campaign=<id>&tab=<strategie|activation|suivi|apercu>.
 *
 * `strategie` remplace `creation` (Tache 9 : onglet "Programmer" renomme
 * "Stratégie"). Round de correction 1 : traiter `creation` comme une valeur
 * simplement invalide (repli sur `undefined` -> onglet Suivi par defaut)
 * PERD SILENCIEUSEMENT une campagne coquille ou brouillon derriere un
 * ancien lien — precisement celles que l'ex-onglet "Programmer" servait a
 * editer, donc les plus probables derriere `tab=creation`. Le chemin exact :
 * `tab` undefined -> l'overlay s'ouvre sur Suivi -> la campagne n'etant pas
 * consultable (ni donnees ni strategie), ni `setSelectedId` ni
 * `setCreationCampaignId` ne s'executent dans `MagelianOverlay.tsx` ->
 * `clearRequest()` efface la demande -> "Aucune campagne a consulter", sans
 * que l'utilisateur sache qu'un identifiant de campagne etait dans son URL.
 *
 * `creation` est donc un ALIAS HERITE de `strategie`, pas une valeur
 * invalide : un lien partage avant le renommage continue d'ouvrir ce qu'il
 * ouvrait. Voir tests/unit/magelian-deep-link.test.ts. */

export type MagelianTab = 'strategie' | 'activation' | 'suivi' | 'apercu';

export interface MagelianDeepLinkRequest {
  campaignId?: string;
  tab?: MagelianTab;
}

/** Ordre du parcours : je programme, j'active, je suis, je regarde.
 *  `activation` ajoutee par la Tache 20 (2026-09-13). */
export const TABS: readonly MagelianTab[] = ['strategie', 'activation', 'suivi', 'apercu'];

/** Anciennes valeurs d'onglet renommees, mappees vers leur valeur actuelle. */
export const ALIAS_TAB: Readonly<Record<string, MagelianTab>> = {
  creation: 'strategie',
};

export function parseMagelianParams(params: URLSearchParams): MagelianDeepLinkRequest | null {
  // URL adressée à un autre overlay (ex. ?overlay=pilotage&action=new&campaign=<id>) :
  // ne pas intercepter, même si un param campaign est présent.
  if (params.get('overlay')) return null;
  const campaignId = params.get('campaign') ?? undefined;
  const rawTab = params.get('tab');
  const resolvedTab = rawTab ? (ALIAS_TAB[rawTab] ?? rawTab) : rawTab;
  const tab = TABS.includes(resolvedTab as MagelianTab) ? (resolvedTab as MagelianTab) : undefined;
  if (!campaignId && !tab) return null;
  return { campaignId, tab };
}
