import { type ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
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
    // La configuration AVANT la session : le client Supabase en a besoin.
    provideAppInitializer(async () => {
      await inject(ConfigService).charger();
      await inject(AuthService).initialiser();
    }),
  ],
};
