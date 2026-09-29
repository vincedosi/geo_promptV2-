import type { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

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
    loadComponent: () => import('./features/accueil/accueil.page').then((m) => m.AccueilPage),
  },
];

/** Lancement autonome, hors AIDA : la connexion + les routes métier. */
export const appRoutes: Routes = [
  {
    path: 'connexion',
    loadComponent: () => import('./features/connexion/connexion.page').then((m) => m.ConnexionPage),
  },
  ...remoteRoutes,
  { path: '**', redirectTo: '' },
];
