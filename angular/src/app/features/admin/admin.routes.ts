import type { Provider } from '@angular/core';
import type { Routes } from '@angular/router';
import { CadreAdminComponent } from './cadre-admin.component';
import { RoleAdminService, roleResoluGuard } from './etat/role-admin.service';

/**
 * Services de l'administration, fournis par la route `admin` et NON par `FOURNISSEURS_DISTANTS`
 * (arbitrage C3). L'injecteur de cette route est un enfant de celui de la racine distante : un
 * service d'API fourni ici reçoit le `HttpClient` porteur de nos intercepteurs (jeton, limiteur,
 * session expirée) — prouvé par `remote.spec.ts`. Les services d'API s'ajoutent tâche par tâche
 * (`@Injectable()` sans `providedIn`, héritiers de `HttpBaseService`).
 */
export const FOURNISSEURS_ADMIN: Provider[] = [RoleAdminService];

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
      // Provisoire jusqu'à T3 (portage du Health check).
      { path: 'health', loadComponent: () => import('./health/health.page').then((m) => m.HealthPage) },
    ],
  },
];
