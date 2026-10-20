import type { CanDeactivateFn } from '@angular/router';

/** Une page qui sait demander confirmation avant d'être quittée (`ImporterPage`). */
export interface SortieConfirmable {
  confirmerSortie(): boolean | Promise<boolean>;
}

/**
 * Garde de la route `importer` (vague finale, I-2 / Q-2) : pendant un envoi Shapefile, quitter « Importer »
 * demande confirmation. Fichier à part, sans import de la page : `admin.routes.ts` la charge à la demande.
 *
 * Limite connue d'Angular (revue des vagues, mineur 7) : après un « Précédent » du navigateur suivi de
 * « Rester », `canceledNavigationResolution` par défaut (`'replace'`) remet la bonne URL mais l'entrée
 * d'historique quittée est consommée — un second « Précédent » saute une page. Non corrigé : passer en
 * `'computed'` se règle dans `provideRouter`, donc dans la configuration du SHELL, qui ne nous appartient pas.
 */
export const quitterImporterGuard: CanDeactivateFn<SortieConfirmable> = (page) => page.confirmerSortie();
