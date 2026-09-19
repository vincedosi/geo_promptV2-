/**
 * Enveloppe une tâche réseau d'une place du sémaphore PARTAGÉ de l'écran de
 * suivi (`semaphoreEcranSuivi`, portée module — un seul budget de 3 requêtes
 * en vol pour TOUT l'écran, quel que soit le nombre de composants montés,
 * Ruling T15-1).
 *
 * Extrait de `SuiviV2.tsx`, où il était local : `DiffusionMapLayer` (carte
 * plein écran) et `DetailTechnique` appelaient `adminFetch` SANS passer par
 * lui. En vue Diffusion l'overlay MAGELIAN reste monté, masqué : un changement
 * de maille déclenchait les 3 appels du cœur de `SuiviV2` PLUS les 2 de la
 * carte, soit 5 requêtes en vol pour un seul geste — au-delà du budget que
 * `CLAUDE.md` fixe à 3 appels Supabase simultanés.
 *
 * `obtenirAlignementPartage` / `obtenirListeCampagnesPartagee`
 * (`lib/campagne/cache-alignement.ts`, `cache-campagnes.ts`) gèrent leur place
 * EUX-MÊMES en interne (Ruling T15-2) : ne jamais les envelopper ici aussi, ce
 * serait réserver deux places pour un seul appel réseau.
 */
import { semaphoreEcranSuivi } from '@/lib/campagne/semaphore-suivi';

export function avecSemaphore<T>(tache: () => Promise<T>): Promise<T> {
  return semaphoreEcranSuivi.acquerir().then(async (liberer) => {
    try { return await tache(); } finally { liberer(); }
  });
}
