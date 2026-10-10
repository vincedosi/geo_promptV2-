import { ETAT_DEFAUT, ecrireEtatUrl, lireEtatUrl } from '../../risques/logique/etat-url';
import { naturesDesTypes } from './natures-risque';

/**
 * Les deux portes de la carte vers le module risque (lot 4, T13) : ce qu'elles écrivent dans `?risque=`.
 *
 * Le module lit TOUT son état dans ce paramètre unique, encodé par `ecrireEtatUrl` (A2 du lot 3) — la page hôte porte
 * déjà ses propres paramètres, et les mélanger rendrait les deux illisibles. Ces fonctions sont pures : elles rendent
 * la valeur de `risque=`, la navigation reste au composant qui a le routeur.
 */

/**
 * « Analyser la population à risque → » du panneau Calques (arbitrage B4) : le `risque=` COURANT est gardé (un état
 * déjà réglé ne se perd pas), et ses `natures` sont REMPLACÉES par celles des types cochés dans Calques — la formule
 * EXACTE de `AnalysePopulationOverlay.tsx:582-588` (`naturesDesTypes`). React passait les types en prop ; ici ils
 * voyagent dans l'URL, le seul canal que le module lit.
 *
 * Les gravités cochées dans Calques ne sont PAS transmises : React les passe aussi en prop, mais le module lit
 * `etat.gravites` et jamais la prop (`AnalysePopulationOverlay.tsx:298`) — parité.
 *
 * @param brut - La valeur courante de `?risque=` (ou `null`).
 * @param types - Les types de risque cochés dans Calques.
 * @returns La nouvelle valeur de `risque=`, ou `null` si l'état est celui par défaut (le paramètre disparaît).
 */
export function risqueDepuisCalques(brut: string | null, types: readonly string[]): string | null {
  const etat = lireEtatUrl(new URLSearchParams(brut ?? ''));
  return ecrireEtatUrl({ ...etat, natures: naturesDesTypes(types) }) || null;
}

/**
 * Un jeu de zones ouvert depuis le panneau Zones (`ouvrirJeuDeZones`, `page.tsx:232-240`) : l'état PAR DÉFAUT, à
 * l'étape ④, sur ce jeu. React repart lui aussi du défaut (`ETAT_RISQUE_DEFAUT`), sans rien hériter de Calques.
 */
export function risqueDuJeu(id: string): string {
  return ecrireEtatUrl({ ...ETAT_DEFAUT, etape: 'zones', jeu: id });
}
