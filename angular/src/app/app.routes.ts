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
import { OrganisationsApi } from './features/session/data/organisations.api';
import { CarreauxApi } from './features/carte/data/carreaux.api';
import { CarteApi } from './features/carte/data/carte.api';
import { IrisApi } from './features/carte/data/iris.api';
import { RadioApi } from './features/carte/data/radio.api';
import { CiviqueApi } from './features/carte/data/civique.api';
import { MeteoApi } from './features/carte/data/meteo.api';
import { ZonesCustomApi } from './features/carte/data/zones-custom.api';
import { IsochronesApi } from './features/carte/data/isochrones.api';
import { AnalysesApi } from './features/carte/data/analyses.api';
import { ZonesRisqueApi } from './features/risques/data/zones-risque.api';
import { ProfilRisqueApi } from './features/risques/data/profil-risque.api';
import { ReferentielApi } from './features/risques/data/referentiel.api';
import { JeuxZonesApi } from './features/risques/data/jeux-zones.api';
import { SimulationApi } from './features/risques/data/simulation.api';
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
 * Ordre de NOS intercepteurs : limiteur, puis jeton, puis session expirée
 * (après le jeton). « En premier » ne vaut que parmi les nôtres : Angular fait
 * passer son intercepteur XSRF (`xsrfInterceptorFn`, ajouté par
 * `provideHttpClient`) avant eux.
 */
const FOURNISSEURS_DISTANTS: (Provider | EnvironmentProviders)[] = [
  provideHttpClient(
    withInterceptors([limiteurInterceptor, jetonInterceptor, sessionExpireeInterceptor]),
    withRequestsMadeViaParent(),
  ),
  SitesRisqueApi,
  ZonesRisqueApi,
  ProfilRisqueApi,
  ReferentielApi,
  JeuxZonesApi,
  SimulationApi,
  OrganisationsApi,
  ZonesCustomApi,
  CarreauxApi,
  IrisApi,
  CarteApi,
  RadioApi,
  CiviqueApi,
  MeteoApi,
  IsochronesApi,
  AnalysesApi,
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
    // Après un ÉCHEC de démarrage, une navigation vers une page enfant (menu du
    // shell) réutilise cette route : sans `always`, son garde ne repartirait
    // pas et l'erreur resterait affichée. `demarrer()` est idempotent — une
    // fois réussi, le garde ne fait que relire une promesse résolue.
    runGuardsAndResolvers: 'always',
    children: [
      // Écrans PLEIN ÉCRAN, hors de `mg-coquille` : comme `/map` en React (AppSidebar.tsx:348,
      // MainPadding.tsx, TopRightChrome.tsx : ni barre, ni chrome, ni marge). Ils restent sous
      // la racine distante, donc sous ses fournisseurs et son `authGuard`.
      {
        path: 'essai-carte',
        canActivate: [authGuard],
        loadComponent: () => import('./features/essai-carte/essai-carte.page').then((m) => m.EssaiCartePage),
      },
      // L'ancienne adresse du module risque (lot 3). Il vit désormais SOUS la carte (ci-dessous) ; la redirection est
      // RELATIVE, donc reste sous le préfixe de l'hôte, et garde `?risque=` — un lien partagé au lot 3 marche encore.
      { path: 'risques', redirectTo: 'carte/risques' },
      // La carte principale (lot 4, React `/map`) : route plein écran (arbitrage B1) ; une navigation de requête la
      // RÉUTILISE, elle ne la recrée pas. Son enfant `risques` est le module « Population à risque industriel »
      // (lot 3), rendu par l'outlet de la carte EN SURIMPRESSION, la carte intacte dessous — comme l'overlay React
      // monté au-dessus de `/map` (arbitrage B2). Ouvrir puis fermer le module ne recrée jamais la carte. Son état
      // vit dans `?risque=` (A2) ; une navigation de requête RÉUTILISE l'écran.
      {
        path: 'carte',
        canActivate: [authGuard],
        loadComponent: () => import('./features/carte/carte.page').then((m) => m.CartePage),
        children: [
          { path: 'risques', loadComponent: () => import('./features/risques/risque.page').then((m) => m.RisquePage) },
        ],
      },
      {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./layout/coquille.component').then((m) => m.CoquilleComponent),
        children: [
          { path: '', loadComponent: () => import('./features/accueil/accueil.page').then((m) => m.AccueilPage) },
          { path: 'catalogue', loadComponent: () => import('./features/catalogue/catalogue.page').then((m) => m.CataloguePage) },
          { path: 'admin', loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ROUTES_ADMIN) },
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
