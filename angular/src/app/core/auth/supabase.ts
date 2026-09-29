import { InjectionToken, inject } from '@angular/core';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '../config/config.service';

/**
 * Le client Supabase du navigateur, par @supabase/ssr et non supabase-js seul.
 *
 * @supabase/ssr range la session dans des COOKIES, au format de l'application
 * actuelle. C'est indispensable : middleware.ts protège /api/tiles, /api/ref,
 * /api/map/pois… par le cookie de session et ignore le Bearer. Les cookies ne
 * dépendant pas du port, une session ouverte sur :3000 vaut aussi sur :4200.
 * Voir « Le piège du cookie », docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md.
 */
export const SUPABASE = new InjectionToken<SupabaseClient>('SUPABASE', {
  providedIn: 'root',
  factory: () => {
    const { supabaseUrl, supabaseAnonKey } = inject(ConfigService).valeur;
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  },
});
