import { InjectionToken, isDevMode } from '@angular/core';

/**
 * Sommes-nous hors production ? L'équivalent de `process.env.NODE_ENV === 'development'`
 * côté React (`components/AppSidebar.tsx:268`, pied « Online »). Un jeton plutôt qu'un
 * appel direct à `isDevMode()` : un test simule la production en le fournissant à `false`.
 * Dans un hôte AIDA, `isDevMode()` est celui du `@angular/core` PARTAGÉ, donc le mode de
 * build du shell — c'est bien lui qui dit si l'on est en production.
 * Seul endroit qui décide de l'affichage « développement » (pied « Online », section
 * « Développement » de la barre latérale).
 */
export const MODE_DEVELOPPEMENT = new InjectionToken<boolean>('MODE_DEVELOPPEMENT', {
  providedIn: 'root',
  factory: () => isDevMode(),
});
