/**
 * ⑥ Plan — des plateformes d'une extraction aux canaux d'une campagne (lot 6, T2, arbitrage A-5), logique pure.
 *
 * Choisir une extraction PRÉ-COCHE les plateformes de son résumé (`zone_set_extractions.plateformes`) ; l'utilisateur
 * peut décocher. La correspondance `plateformes_geo.plateforme` → code de `dsp_channel_registry` tient dans UNE table :
 * mesurée le 25/10, elle est l'identité pour les quatre plateformes de ⑤ ; une plateforme ajoutée à `plateformes_geo`
 * sans ligne ici est dite « non reliée » et n'est pas cochée, plutôt que de deviner son canal.
 */
import { formaterDecimal } from '../../../../core/format/nombre';
import type { Maille, Plateforme } from '../jeu/plateformes';
import type { ProgDraft } from './brouillon';
import type { CampaignChannels, ResolvedChannel } from './canaux';

export const CANAL_DE_PLATEFORME: Readonly<Record<Plateforme, string>> = {
  dv360: 'dv360', ttd: 'ttd', meta: 'meta', tiktok: 'tiktok',
};

/** Le code `plateformes_geo` d'un canal : l'inverse de `CANAL_DE_PLATEFORME`. */
const PLATEFORME_DE_CANAL = new Map(Object.entries(CANAL_DE_PLATEFORME).map(([p, c]) => [c, p as Plateforme]));

/** Le résumé figé d'une plateforme dans une extraction (`zone_set_extractions.plateformes`), réduit à ce que ⑥ lit. */
export interface ResumePlateformeFige {
  plateforme: string;
  maille: Maille;
  exacte?: boolean;
  n_unites?: number;
  taux_utile?: number | null;
}

/** Une extraction figée, réduite à ce que ⑥ lit ; `plateformes` nul : un jeu RISQUE (aucun résumé par plateforme). */
export interface ExtractionFigee {
  n_retenus: number;
  taux_utile: number | null;
  plateformes: readonly ResumePlateformeFige[] | null;
}

/** Ce que ⑥ dit d'un canal coché face à l'extraction : sa maille, ses unités, son taux d'utile, et ses CP. */
export interface ResumeCanal {
  maille: Maille;
  nUnites: number;
  /** « exacte » ou « 12,3 % » ; `null` si inconnu. */
  utile: string | null;
  /** Le canal achète au code postal : sa répartition par CP se montre. */
  auCp: boolean;
  /** La plateforme à passer à la lecture des CP (`?plateforme=`) ; `undefined` : le plan CP entier (jeu risque). */
  filtreCp: Plateforme | undefined;
}

/** Le taux d'utile d'une plateforme d'extraction : « exacte », « 12,3 % », ou `null` s'il est inconnu. */
export function utilePlateforme(p: Pick<ResumePlateformeFige, 'exacte' | 'taux_utile'>): string | null {
  if (p.exacte) return 'exacte';
  return p.taux_utile == null ? null : `${formaterDecimal(Number(p.taux_utile))} %`;
}

/**
 * Le résumé d'un canal coché dans l'extraction choisie ; `null` sans extraction, ou si sa plateforme n'y est pas
 * (« Hors de l'extraction »). Un jeu RISQUE n'a pas de résumé par plateforme mais tout son plan est au CP : chaque canal
 * s'y lit « toutes plateformes au CP » (revue finale, V-7) — les CP retenus de l'extraction, son taux d'utile, et la
 * répartition sur le plan CP entier.
 */
export function resumeDuCanal(x: ExtractionFigee | null, code: string): ResumeCanal | null {
  if (!x) return null;
  if (x.plateformes === null) {
    return { maille: 'cp', nUnites: x.n_retenus, utile: utilePlateforme({ taux_utile: x.taux_utile }), auCp: true, filtreCp: undefined };
  }
  const plateforme = PLATEFORME_DE_CANAL.get(code);
  const p = plateforme ? x.plateformes.find((r) => r.plateforme === plateforme) : undefined;
  if (!p) return null;
  return { maille: p.maille, nUnites: p.n_unites ?? 0, utile: utilePlateforme(p), auCp: p.maille === 'cp', filtreCp: plateforme };
}

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

/**
 * Le brouillon après le choix d'une EXTRACTION en section Cible (lot 6, T4) : le jeu ET la version figée qui sera
 * rattachée (A-3), puis la sélection pré-cochée par son résumé (A-5) — re-pré-cochée à chaque changement d'extraction.
 * Budgets et CPM saisis ne sont PAS touchés : ceux des plateformes restantes survivent, ceux des plateformes retirées
 * ne comptent plus (`draftTotalBudget` filtre par la sélection) et le serveur les élague (`pruneBudgets`). Sans
 * catalogue (canaux pas encore lus), la sélection reste telle quelle.
 */
export function poserExtraction(
  d: ProgDraft,
  jeu: { id: string; nom: string; version: number },
  extraction: { id: string; version: number; plateformes: readonly { plateforme: string }[] | null },
  catalogue: readonly ResolvedChannel[] | null,
): ProgDraft {
  const channels = catalogue ? preselectionDepuisExtraction(extraction.plateformes, catalogue, d.channels).channels : d.channels;
  return {
    ...d,
    jeuZones: { id: jeu.id, nom: jeu.nom, version: jeu.version, extraction: { id: extraction.id, version: extraction.version } },
    channels,
  };
}
