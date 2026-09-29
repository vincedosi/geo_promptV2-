import { type ApplicationConfig, EnvironmentInjector, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { appRoutes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { ConfigService } from './core/config/config.service';
import { jetonInterceptor } from './core/http/jeton.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([jetonInterceptor])),
    // La configuration AVANT la session : le token SUPABASE lit
    // ConfigService.valeur dans sa factory, donc AuthService (qui l'injecte)
    // ne doit être construit qu'APRÈS configService.charger(). Mais inject()
    // après un await est hors contexte d'injection (NG0203) : on capture
    // l'injecteur avant l'await et on l'utilise via runInInjectionContext
    // pour l'inject(AuthService) différé.
    provideAppInitializer(async () => {
      const configService = inject(ConfigService);
      const injector = inject(EnvironmentInjector);
      await configService.charger();
      const authService = runInInjectionContext(injector, () => inject(AuthService));
      await authService.initialiser();
    }),
  ],
};
