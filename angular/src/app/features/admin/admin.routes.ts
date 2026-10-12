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
 * `admin` seul mène à `systeme` (React répond 404 sur `/admin` : une page vide dans un hôte serait
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
      { path: '', pathMatch: 'full', redirectTo: 'systeme' },
      // Trois pages à onglets (amendement du 2026-10-12) : Accès, Données, Système. Chaque onglet est
      // une sous-route RELATIVE de sa page (lien partageable, retour arrière juste) ; un onglet
      // n'existe que lorsque son écran est porté.
      {
        path: 'systeme',
        loadComponent: () => import('./systeme/systeme.page').then((m) => m.SystemePage),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'sante' },
          { path: 'sante', loadComponent: () => import('./health/health.page').then((m) => m.HealthPage) },
          { path: 'fraicheur', loadComponent: () => import('./health/fraicheur.component').then((m) => m.FraicheurComponent) },
        ],
      },
      {
        path: 'donnees',
        loadComponent: () => import('./donnees/donnees.page').then((m) => m.DonneesPage),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'qualite' },
          {
            path: 'qualite',
            loadComponent: () => import('./qualite-donnees/qualite-donnees.page').then((m) => m.QualiteDonneesPage),
          },
        ],
      },
      // Les anciennes adresses (segments recopiés de React, C1) restent valables. `redirectTo` RELATIF
      // (sans `/`) : il reste sous le préfixe de montage, qui appartient au shell.
      { path: 'health', pathMatch: 'full', redirectTo: 'systeme' },
      { path: 'qualite-donnees', pathMatch: 'full', redirectTo: 'donnees/qualite' },
      // Accès (« Espaces de travail » du 2026-10-09 au 2026-10-10) : une colonne persistante (la
      // page) et la fiche en enfant. `EspacesEtatService` est fourni par la page, détruit avec elle.
      // Les noms internes (dossier `espaces/`, `EspacesPage`) n'ont pas changé. Chemins fixes
      // (`socle`, `comptes`) AVANT `:id`, qui les avalerait sinon.
      {
        path: 'acces',
        loadComponent: () => import('./espaces/espaces.page').then((m) => m.EspacesPage),
        children: [
          { path: '', loadComponent: () => import('./espaces/aucun-espace.component').then((m) => m.AucunEspaceComponent) },
          { path: 'socle', loadComponent: () => import('./espaces/fiche-socle.component').then((m) => m.FicheSocleComponent) },
          { path: 'comptes', loadComponent: () => import('./espaces/vue-comptes.component').then((m) => m.VueComptesComponent) },
          { path: ':id', loadComponent: () => import('./espaces/fiche-espace.component').then((m) => m.FicheEspaceComponent) },
        ],
      },
      // L'ancienne adresse reste valable : un lien ou un favori `espaces/**` ne casse pas.
      // `redirectTo` RELATIF (sans `/`) : il reste sous le préfixe de montage, qui appartient au shell.
      { path: 'espaces', pathMatch: 'full', redirectTo: 'acces' },
      { path: 'espaces/:id', pathMatch: 'full', redirectTo: 'acces/:id' },
    ],
  },
];
