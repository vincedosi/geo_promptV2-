import type { CanDeactivateFn } from '@angular/router';

/** Une page qui sait demander confirmation avant d'être quittée (`ImporterPage`). */
export interface SortieConfirmable {
  confirmerSortie(): boolean | Promise<boolean>;
}

/**
 * Garde de la route `importer` (vague finale, I-2 / Q-2) : pendant un envoi Shapefile, quitter « Importer »
 * demande confirmation. Fichier à part, sans import de la page : `admin.routes.ts` la charge à la demande.
 */
export const quitterImporterGuard: CanDeactivateFn<SortieConfirmable> = (page) => page.confirmerSortie();
