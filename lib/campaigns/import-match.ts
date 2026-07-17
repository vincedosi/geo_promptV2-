/**
 * Rattachement import → campagne existante (spec 2026-07-16) : quand aucun
 * campaign_id n'est demandé explicitement, on cherche la campagne de l'org
 * dont la liaison plateforme du canal source (channels.links[dspSource])
 * référence la campagne du fichier — à défaut, dont le nom est identique.
 */
export interface MatchCandidate {
  id: string;
  name: string;
  dsp_source: string | null;
  geo_strategy: Record<string, unknown> | null;
}

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export function findMatchingCampaign(
  candidates: MatchCandidate[],
  dspSource: string,
  fileCampaignName: string,
): { id: string; name: string; matchedBy: 'link' | 'name' } | null {
  const wanted = norm(fileCampaignName);
  if (!wanted) return null;
  for (const c of candidates) {
    const links = ((c.geo_strategy as { channels?: { links?: Record<string, Record<string, unknown>> } } | null)
      ?.channels?.links ?? {})[dspSource];
    if (links && (norm(links.campaign_id) === wanted || norm(links.campaign_name) === wanted)) {
      return { id: c.id, name: c.name, matchedBy: 'link' };
    }
  }
  const byName = candidates.find((c) => norm(c.name) === wanted);
  return byName ? { id: byName.id, name: byName.name, matchedBy: 'name' } : null;
}
