import { creerSemaphore, type Semaphore } from './semaphore';

/**
 * Sémaphore UNIQUE (portée module, pas une instance par composant) partagé
 * par TOUS les appels réseau de l'écran de suivi : `BarreContexteCampagne`
 * (montée à deux endroits sans ancêtre commun — `app/map/page.tsx` en vue
 * carte, `SuiviV2` en vue suivi, potentiellement montées EN MÊME TEMPS : le
 * contenu de l'overlay MAGELIAN reste monté, masqué, quand on bascule vers
 * la carte) et `SuiviV2` lui-même. Une instance PAR COMPOSANT n'aurait borné
 * que la concurrence PROPRE à chacun — deux instances à 3 chacune, montées
 * ensemble, auraient encore pu totaliser 6 requêtes en vol. Un seul budget
 * de 3 pour tout ce que cet écran demande à Supabase, quel que soit le
 * nombre de montages actifs (Ruling T15-1, relecture Tâche 15).
 */
export const semaphoreEcranSuivi: Semaphore = creerSemaphore(3);
