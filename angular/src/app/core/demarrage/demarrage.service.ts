import { EnvironmentInjector, Injectable, inject, runInInjectionContext, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '../config/config.service';

/**
 * Démarrage de l'application : configuration PUIS session — dans cet ordre,
 * le client Supabase lisant la configuration à sa construction. Il vivait dans
 * un APP_INITIALIZER, que le shell AIDA n'exécute pas : il est désormais
 * déclenché par la route racine de `remoteRoutes`, donc dans les deux modes.
 * Une seule promesse, partagée : naviguer dix fois ne recharge rien.
 *
 * Zoneless : l'issue du démarrage ne passe que par des signals (`erreur`) et
 * par la résolution du garde de route — rien ne dépend d'une détection de
 * changement déclenchée par zone.js.
 */
@Injectable({ providedIn: 'root' })
export class DemarrageService {
  private readonly config = inject(ConfigService);
  private readonly injecteur = inject(EnvironmentInjector);
  private enCours: Promise<void> | null = null;
  private readonly _erreur = signal<string | null>(null);
  readonly erreur = this._erreur.asReadonly();

  demarrer(): Promise<void> {
    this.enCours ??= (async () => {
      try {
        await this.config.charger();
        // AuthService injecté APRÈS le chargement : son client Supabase lit
        // la configuration dans sa fabrique (même raison que l'ancien app.config).
        // inject() après un await est hors contexte (NG0203) : l'injecteur a été
        // capturé à la construction, on le rejoue ici.
        const auth = runInInjectionContext(this.injecteur, () => inject(AuthService));
        await auth.initialiser();
      } catch (e) {
        this._erreur.set(e instanceof Error ? e.message : 'Démarrage impossible.');
      }
    })();
    return this.enCours;
  }
}
