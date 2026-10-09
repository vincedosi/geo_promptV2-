import type { Provider } from '@angular/core';
import type { Routes } from '@angular/router';
import { CadreAdminComponent } from './cadre-admin.component';
import { EspacesApi } from './espaces/data/espaces.api';
import { RoleAdminService, roleResoluGuard } from './etat/role-admin.service';
import { FraicheurApi } from './health/data/fraicheur.api';
import { HealthApi } from './health/data/health.api';
import { QualiteApi } from './qualite-donnees/data/qualite.api';

/**
 * Services de l'administration, fournis par la route `admin` et NON par `FOURNISSEURS_DISTANTS`
 * (arbitrage C3). L'injecteur de cette route est un enfant de celui de la racine distante : un
 * service d'API fourni ici reçoit le `HttpClient` porteur de nos intercepteurs (jeton, limiteur,
 * session expirée) — prouvé par `remote.spec.ts`. Les services d'API s'ajoutent tâche par tâche
 * (`@Injectable()` sans `providedIn`, héritiers de `HttpBaseService`).
 */
export const FOURNISSEURS_ADMIN: Provider[] = [RoleAdminService, HealthApi, FraicheurApi, QualiteApi, EspacesApi];

/**
 * L'administration (lot 6), enfant de la coquille comme `/admin/*` en React (arbitrage C1).
 * `admin` seul mène à `health` (React répond 404 sur `/admin` : une page vide dans un hôte serait
 * pire). `runGuardsAndResolvers: 'always'` : le garde rejoue `charger()` à chaque navigation —
 * idempotent pour une même session, il relit le rôle si l'utilisateur a changé.
 */
export const ROUTES_ADMIN: Routes = [
  {
    path: '',
    component: CadreAdminComponent,
    providers: FOURNISSEURS_ADMIN,
    canActivate: [roleResoluGuard],
    runGuardsAndResolvers: 'always',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'health' },
      { path: 'health', loadComponent: () => import('./health/health.page').then((m) => m.HealthPage) },
      {
        path: 'qualite-donnees',
        loadComponent: () => import('./qualite-donnees/qualite-donnees.page').then((m) => m.QualiteDonneesPage),
      },
      // Espaces de travail (2026-10-09) : une colonne persistante (la page) et la fiche en enfant.
      // `EspacesEtatService` est fourni par la page, détruit avec elle.
      {
        path: 'espaces',
        loadComponent: () => import('./espaces/espaces.page').then((m) => m.EspacesPage),
        children: [
          { path: '', loadComponent: () => import('./espaces/aucun-espace.component').then((m) => m.AucunEspaceComponent) },
          { path: 'socle', loadComponent: () => import('./espaces/fiche-socle.component').then((m) => m.FicheSocleComponent) },
          { path: ':id', loadComponent: () => import('./espaces/fiche-espace.component').then((m) => m.FicheEspaceComponent) },
        ],
      },
    ],
  },
];
