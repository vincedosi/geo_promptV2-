/**
 * ⑥ Plan — des plateformes d'une extraction aux canaux d'une campagne (lot 6, T2, arbitrage A-5), logique pure.
 *
 * Choisir une extraction PRÉ-COCHE les plateformes de son résumé (`zone_set_extractions.plateformes`) ; l'utilisateur
 * peut décocher. La correspondance `plateformes_geo.plateforme` → code de `dsp_channel_registry` tient dans UNE table :
 * mesurée le 25/10, elle est l'identité pour les quatre plateformes de ⑤ ; une plateforme ajoutée à `plateformes_geo`
 * sans ligne ici est dite « non reliée » et n'est pas cochée, plutôt que de deviner son canal.
 */
import type { Plateforme } from '../jeu/plateformes';
import type { CampaignChannels, ResolvedChannel } from './canaux';

export const CANAL_DE_PLATEFORME: Readonly<Record<Plateforme, string>> = {
  dv360: 'dv360', ttd: 'ttd', meta: 'meta', tiktok: 'tiktok',
};

export interface Preselection {
  /** La sélection à poser : dsps et socials de l'extraction, ad server gardé. */
  channels: CampaignChannels;
  /** Plateformes sans canal (absentes de la table ou du catalogue) : affichées « non relié ». */
  nonRelies: string[];
  /** Plateformes dont le canal existe mais n'est pas disponible (ni connecté, ni démo) : non cochées. */
  indisponibles: string[];
}

/**
 * La sélection pré-cochée par une extraction. Sans résumé (jeu risque, `plateformes` nul), la sélection courante est
 * gardée telle quelle : le jeu risque ne dit pas pour quelles plateformes il a été figé.
 */
export function preselectionDepuisExtraction(
  resumes: readonly { plateforme: string }[] | null, catalogue: readonly ResolvedChannel[], courante: CampaignChannels,
): Preselection {
  if (!resumes) return { channels: courante, nonRelies: [], indisponibles: [] };
  const parCode = new Map(catalogue.map((c) => [c.code, c]));
  const channels: CampaignChannels = { dsps: [], socials: [], ad_server: courante.ad_server };
  const nonRelies: string[] = [];
  const indisponibles: string[] = [];
  for (const { plateforme } of resumes) {
    const code = (CANAL_DE_PLATEFORME as Record<string, string | undefined>)[plateforme];
    const canal = code ? parCode.get(code) : undefined;
    if (!canal || canal.category === 'adserver') nonRelies.push(plateforme);
    else if (!canal.available) indisponibles.push(plateforme);
    else (canal.category === 'dsp' ? channels.dsps : channels.socials).push(canal.code);
  }
  return { channels, nonRelies, indisponibles };
}
