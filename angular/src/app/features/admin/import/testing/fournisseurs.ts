import type { Provider } from '@angular/core';
import { ConfigService } from '../../../../core/config/config.service';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { CategoriesPoiApi } from '../../commun/data/categories-poi.api';
import { OrganisationsListeApi } from '../../commun/data/organisations-liste.api';
import { ImportPoiApi } from '../data/import-poi.api';
import { ImportPoiService } from '../etat/import-poi.service';

/**
 * Fournisseurs MÉTIER des specs des étapes de l'import POI (factorisation F-4, lot 6, vague finale) : les sept
 * specs de `etapes/` les recopiaient à l'identique. Chaque spec garde son `monter()` (le parcours d'état avant
 * le composant diffère d'une étape à l'autre). Code de TEST seulement.
 *
 * `provideHttpClient()` et `provideHttpClientTesting()` restent écrits dans chaque spec : ce fichier n'est pas
 * un `*.spec.ts`, et `tests/unit/angular/imports-partages.test.ts` interdit à tout source non-spec d'importer
 * `@angular/common/http/testing` à l'exécution (revue des vagues, Important 1 — le garde n'est pas élargi).
 */
export function fournisseursImportPoi(): Provider[] {
  return [
    ImportPoiApi, CategoriesPoiApi, OrganisationsListeApi, NotificationsService, ImportPoiService,
    { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
  ];
}
