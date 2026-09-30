import { type ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { appRoutes } from './app.routes';

/**
 * Lancement AUTONOME seulement : le shell AIDA n'exécute jamais ce fichier.
 * Tout ce dont l'application a besoin (configuration, session, intercepteurs,
 * services d'API) est donc porté par `remoteRoutes` (app.routes.ts). Ne reste
 * ici que ce qu'un hôte fournit de lui-même : un routeur, et un HttpClient
 * SANS intercepteurs — celui que `ConfigService` et le `withRequestsMadeViaParent`
 * de la route utilisent.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(),
  ],
};
