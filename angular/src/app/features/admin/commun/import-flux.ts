import type { NiveauJournal } from './journal.component';

/**
 * Constantes partagées par les imports en flux et leurs briques d'affichage (revue des vagues, mineur 8) :
 * un service d'état (`RadioImportService`, `ImportPoiService`…) les lit ici plutôt que dans un fichier de
 * COMPOSANT. `journal.component.ts` et `progression-import.component.ts` les ré-exportent : leurs imports
 * existants restent valables.
 */

/**
 * Règle du lot 3 : un flux fini sans événement final est un échec, jamais un succès silencieux. Texte unique des
 * quatre imports en flux (POI, IRIS, Radio, DSP) — factorisation F-5, lot 6, vague finale.
 */
export const MESSAGE_INTERROMPU = 'Le flux s’est interrompu avant la fin.';

/** Niveaux actifs au départ du filtre de journal, comme React : `debug` est masqué. */
export const NIVEAUX_ACTIFS_INITIAUX: readonly NiveauJournal[] = ['info', 'warn', 'error', 'success'];
