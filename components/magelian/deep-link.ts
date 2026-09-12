/** Deep-link de l'overlay MAGELIAN : /map?campaign=<id>&tab=<strategie|suivi|apercu>.
 *
 * `strategie` remplace `creation` (Tache 9 : onglet "Programmer" renomme
 * "Stratégie"). Un ancien lien portant `tab=creation` degrade sans casser :
 * `TABS.includes` le rejette comme n'importe quel onglet inconnu, `tab`
 * devient `undefined`, et l'overlay s'ouvre sur son onglet par defaut
 * (Suivi) au lieu de l'onglet demande — la campagne, elle, reste ciblee. */

export type MagelianTab = 'strategie' | 'suivi' | 'apercu';

export interface MagelianDeepLinkRequest {
  campaignId?: string;
  tab?: MagelianTab;
}

const TABS: readonly MagelianTab[] = ['strategie', 'suivi', 'apercu'];

export function parseMagelianParams(params: URLSearchParams): MagelianDeepLinkRequest | null {
  // URL adressée à un autre overlay (ex. ?overlay=pilotage&action=new&campaign=<id>) :
  // ne pas intercepter, même si un param campaign est présent.
  if (params.get('overlay')) return null;
  const campaignId = params.get('campaign') ?? undefined;
  const rawTab = params.get('tab');
  const tab = TABS.includes(rawTab as MagelianTab) ? (rawTab as MagelianTab) : undefined;
  if (!campaignId && !tab) return null;
  return { campaignId, tab };
}
