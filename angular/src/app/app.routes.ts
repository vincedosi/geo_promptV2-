import type { EnvironmentProviders, Provider } from '@angular/core';
import { provideHttpClient, withInterceptors, withRequestsMadeViaParent } from '@angular/common/http';
import type { Routes } from '@angular/router';
import { App } from './app';
import { authGuard } from './core/auth/auth.guard';
import { sansSessionGuard } from './core/auth/sans-session.guard';
import { STRATEGIE_AUTONOME, STRATEGIE_SANS_SESSION } from './core/auth/strategie-sans-session';
import { demarrageGuard } from './core/demarrage/demarrage.guard';
import { jetonInterceptor } from './core/http/jeton.interceptor';
import { limiteurInterceptor } from './core/http/limiteur.interceptor';
import { sessionExpireeInterceptor } from './core/http/session-expiree.interceptor';
import { SitesRisqueApi } from './features/risques/data/sites-risque.api';
import { ZonesRisqueApi } from './features/risques/data/zones-risque.api';
import { RacineDistanteComponent } from './layout/racine-distante.component';

/**
 * Ce que l'application exige pour fonctionner, porté PAR la route — le shell
 * AIDA ne charge que `remoteRoutes`, jamais app.config.ts.
 * - `provideHttpClient` de route : nos intercepteurs s'appliquent quel que soit
 *   l'hôte. `withRequestsMadeViaParent` : la requête continue ensuite par le
 *   HttpClient de l'hôte (ses propres intercepteurs, son backend) — les NÔTRES
 *   passent donc en premier, ceux de l'hôte ensuite.
 * - Les services d'API sont fournis ICI et non en `providedIn: 'root'` : un
 *   service racine recevrait le HttpClient de l'hôte, sans nos intercepteurs.
 * Ordre des intercepteurs : limiteur en premier, session expirée après le jeton.
 */
const FOURNISSEURS_DISTANTS: (Provider | EnvironmentProviders)[] = [
  provideHttpClient(
    withInterceptors([limiteurInterceptor, jetonInterceptor, sessionExpireeInterceptor]),
    withRequestsMadeViaParent(),
  ),
  SitesRisqueApi,
  ZonesRisqueApi,
];

/**
 * Contrat de fédération AIDA (doc §4.4) : la FORME de cette constante et son
 * point d'exposition (`./Routes`) ne changent pas sans concertation ; seul son
 * contenu grandit à chaque lot. Tout lien interne est RELATIF : le shell monte
 * ces routes sous un préfixe qu'on ne connaît pas.
 */
export const remoteRoutes: Routes = [
  {
    path: '',
    component: RacineDistanteComponent,
    providers: FOURNISSEURS_DISTANTS,
    canActivate: [demarrageGuard],
    children: [
      {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./layout/coquille.component').then((m) => m.CoquilleComponent),
        children: [
          { path: '', loadComponent: () => import('./features/accueil/accueil.page').then((m) => m.AccueilPage) },
          { path: 'catalogue', loadComponent: () => import('./features/catalogue/catalogue.page').then((m) => m.CataloguePage) },
          { path: 'essai-carte', loadComponent: () => import('./features/essai-carte/essai-carte.page').then((m) => m.EssaiCartePage) },
        ],
      },
    ],
  },
];

/**
 * Lancement autonome, hors AIDA (doc §4.4) — `/connexion` n'existe que dans ce mode.
 * La route `app` fournit donc `STRATEGIE_SANS_SESSION = rediriger` : sans
 * session, gardes, coquille et racine renvoient vers `/connexion`. Un hôte ne
 * la fournit pas, et le défaut racine (`message`) s'applique — voir
 * `strategie-sans-session.ts`.
 * `App` est monté deux fois, comme dans l'exemple de la doc : composant
 * d'amorçage, puis composant de la route `app`. Sans effet : il n'injecte que
 * `ThemeService`, un singleton racine, et son gabarit n'est qu'un `<router-outlet />`.
 */
export const appRoutes: Routes = [
  { path: '', redirectTo: 'app', pathMatch: 'full' },
  {
    path: 'connexion',
    canActivate: [demarrageGuard, sansSessionGuard],
    loadComponent: () => import('./features/connexion/connexion.page').then((m) => m.ConnexionPage),
  },
  {
    path: 'app',
    component: App,
    providers: [{ provide: STRATEGIE_SANS_SESSION, useValue: STRATEGIE_AUTONOME }],
    children: remoteRoutes,
  },
  { path: '**', redirectTo: 'app' },
];
