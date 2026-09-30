import type { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { sansSessionGuard } from './core/auth/sans-session.guard';

/**
 * Les routes MÉTIER, toutes protégées. Nommée `remoteRoutes` parce que c'est
 * la constante que le shell AIDA chargera le jour de l'intégration (voir
 * « Compatibilité AIDA » dans la feuille de route) : sa FORME ne change pas
 * sans concertation, son contenu grandit à chaque lot.
 */
export const remoteRoutes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/coquille.component').then((m) => m.CoquilleComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./features/accueil/accueil.page').then((m) => m.AccueilPage),
      },
      {
        path: 'catalogue',
        loadComponent: () => import('./features/catalogue/catalogue.page').then((m) => m.CataloguePage),
      },
      {
        path: 'essai-carte',
        loadComponent: () => import('./features/essai-carte/essai-carte.page').then((m) => m.EssaiCartePage),
      },
    ],
  },
];

/** Lancement autonome, hors AIDA : la connexion + les routes métier. */
export const appRoutes: Routes = [
  {
    path: 'connexion',
    canActivate: [sansSessionGuard],
    loadComponent: () => import('./features/connexion/connexion.page').then((m) => m.ConnexionPage),
  },
  ...remoteRoutes,
  { path: '**', redirectTo: '' },
];
