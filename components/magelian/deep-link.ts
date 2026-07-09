/** Deep-link de l'overlay MAGELIAN : /map?campaign=<id>&tab=<creation|suivi|apercu>. */

export type MagelianTab = 'creation' | 'suivi' | 'apercu';

export interface MagelianDeepLinkRequest {
  campaignId?: string;
  tab?: MagelianTab;
}

const TABS: readonly MagelianTab[] = ['creation', 'suivi', 'apercu'];

export function parseMagelianParams(params: URLSearchParams): MagelianDeepLinkRequest | null {
  const campaignId = params.get('campaign') ?? undefined;
  const rawTab = params.get('tab');
  const tab = TABS.includes(rawTab as MagelianTab) ? (rawTab as MagelianTab) : undefined;
  if (!campaignId && !tab) return null;
  return { campaignId, tab };
}
