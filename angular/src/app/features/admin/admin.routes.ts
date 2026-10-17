import type { Provider } from '@angular/core';
import type { Routes } from '@angular/router';
import { DspApi } from './api/data/dsp.api';
import { CadreAdminComponent } from './cadre-admin.component';
import { EspacesApi } from './espaces/data/espaces.api';
import { RoleAdminService, roleResoluGuard } from './etat/role-admin.service';
import { FraicheurApi } from './health/data/fraicheur.api';
import { HealthApi } from './health/data/health.api';
import { ImportsApi } from './imports/data/imports.api';
import { IrisCrawlerApi } from './iris-crawler/data/iris-crawler.api';
import { QualiteApi } from './qualite-donnees/data/qualite.api';

/**
 * Services de l'administration, fournis par la route `admin` et NON par `FOURNISSEURS_DISTANTS`
 * (arbitrage C3). L'injecteur de cette route est un enfant de celui de la racine distante : un
 * service d'API fourni ici reçoit le `HttpClient` porteur de nos intercepteurs (jeton, limiteur,
 * session expirée) — prouvé par `remote.spec.ts`. Les services d'API s'ajoutent tâche par tâche
 * (`@Injectable()` sans `providedIn`, héritiers de `HttpBaseService`).
 */
export const FOURNISSEURS_ADMIN: Provider[] = [
  RoleAdminService, HealthApi, FraicheurApi, QualiteApi, EspacesApi, DspApi, ImportsApi, IrisCrawlerApi,
];

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
          // Connexions API (T9) : l'écran garde SES sous-onglets (`app/admin/api/layout.tsx`), en
          // sous-routes relatives ; sa racine mène à `dv360` comme `app/admin/api/page.tsx`.
          {
            path: 'api',
            loadComponent: () => import('./api/connexions-api.page').then((m) => m.ConnexionsApiPage),
            children: [
              { path: '', pathMatch: 'full', redirectTo: 'dv360' },
              { path: 'dv360', loadComponent: () => import('./api/dv360.page').then((m) => m.Dv360Page) },
              {
                path: 'meta', data: { fournisseur: 'meta' },
                loadComponent: () => import('./api/fournisseur-a-venir.component').then((m) => m.FournisseurAVenirComponent),
              },
              { path: 'tiktok', loadComponent: () => import('./api/tiktok.page').then((m) => m.TiktokPage) },
              {
                path: 'ttd', data: { fournisseur: 'ttd' },
                loadComponent: () => import('./api/fournisseur-a-venir.component').then((m) => m.FournisseurAVenirComponent),
              },
              { path: 'logs', loadComponent: () => import('./api/journal-dsp.page').then((m) => m.JournalDspPage) },
            ],
          },
        ],
      },
      {
        path: 'donnees',
        loadComponent: () => import('./donnees/donnees.page').then((m) => m.DonneesPage),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'qualite' },
          // Importer (T15, amendement A7) : un sous-onglet par écran d'import PORTÉ (aujourd'hui IRIS seul),
          // `donnees/importer/{poi,shapefile,iris,radio}` ; la racine mène au premier porté.
          {
            path: 'importer',
            loadComponent: () => import('./importer/importer.page').then((m) => m.ImporterPage),
            children: [
              { path: '', pathMatch: 'full', redirectTo: 'iris' },
              // `/dashboard/iris-crawler` de React (segment `admin/iris-crawler` par C1).
              { path: 'iris', loadComponent: () => import('./iris-crawler/iris-crawler.page').then((m) => m.IrisCrawlerPage) },
            ],
          },
          // Historique des imports (T11′, amendement A1) : `/admin/imports` de React, sans l'import OOH.
          { path: 'historique', loadComponent: () => import('./imports/imports.page').then((m) => m.ImportsPage) },
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
      { path: 'imports', pathMatch: 'full', redirectTo: 'donnees/historique' },
      { path: 'iris-crawler', pathMatch: 'full', redirectTo: 'donnees/importer/iris' },
      { path: 'api', pathMatch: 'full', redirectTo: 'systeme/api' },
      { path: 'api/:sous', pathMatch: 'full', redirectTo: 'systeme/api/:sous' },
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
