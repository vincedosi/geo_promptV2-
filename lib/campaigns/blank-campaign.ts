/** Nom par défaut d'une campagne créée vierge depuis l'overlay (naissance MAGELIAN). */
export function defaultCampaignName(d: Date): string {
  return `Nouvelle campagne — ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' })}`;
}

/** Source des campagnes nées dans MAGELIAN (pas d'import DSP à la création). */
export const MAGELIAN_SOURCE = 'magelian';
