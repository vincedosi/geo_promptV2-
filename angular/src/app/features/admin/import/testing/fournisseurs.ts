import type { Provider, EnvironmentProviders } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { CategoriesPoiApi } from '../../commun/data/categories-poi.api';
import { OrganisationsListeApi } from '../../commun/data/organisations-liste.api';
import { ImportPoiApi } from '../data/import-poi.api';
import { ImportPoiService } from '../etat/import-poi.service';

/**
 * Fournisseurs des specs des étapes de l'import POI (factorisation F-4, lot 6, vague finale) : les sept specs
 * de `etapes/` les recopiaient à l'identique. Chaque spec garde son `monter()` (le parcours d'état avant le
 * composant diffère d'une étape à l'autre). Code de TEST seulement.
 */
export function fournisseursImportPoi(): (Provider | EnvironmentProviders)[] {
  return [
    provideHttpClient(), provideHttpClientTesting(), ImportPoiApi, CategoriesPoiApi, OrganisationsListeApi,
    NotificationsService, ImportPoiService,
    { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
  ];
}
