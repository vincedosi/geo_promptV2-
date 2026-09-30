import { type ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { appRoutes } from './app.routes';
import { ECRIRE_HTML } from './core/theme/theme.service';

/**
 * Lancement AUTONOME seulement : le shell AIDA n'exécute jamais ce fichier.
 * Tout ce dont l'application a besoin (configuration, session, intercepteurs,
 * services d'API) est donc porté par `remoteRoutes` (app.routes.ts). Ne reste
 * ici que ce qu'un hôte fournit de lui-même : un routeur, et un HttpClient
 * SANS intercepteurs — celui vers lequel le `withRequestsMadeViaParent` de la
 * route fait continuer nos requêtes. `ConfigService`, lui, ne passe par AUCUN
 * HttpClient fourni : il construit le sien sur le `HttpBackend` de l'injecteur
 * racine (aucun intercepteur, pas même les nôtres : c'est elle qui charge la
 * configuration que lit l'intercepteur de jeton, voir config.service.ts).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(),
    // Le document est le nôtre : ThemeService peut écrire `<html>`. Jamais dans un hôte.
    { provide: ECRIRE_HTML, useValue: true },
  ],
};
