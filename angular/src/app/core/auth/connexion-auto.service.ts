import { HttpClient } from '@angular/common/http';
import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { AuthService } from './auth.service';

/** La route Next de développement qui ouvre la session (`app/api/dev/connexion-auto/route.ts`). */
export const CHEMIN_CONNEXION_AUTO = '/api/dev/connexion-auto';

interface JetonsSession {
  access_token?: unknown;
  refresh_token?: unknown;
}

/**
 * Connexion automatique du lancement AUTONOME en développement local
 * (décision du 2026-11-02 : plus d'écran de connexion en local).
 *
 * N'est appelé que par `authGuard`, et seulement quand la stratégie de la
 * route porte `connexionAuto` (`STRATEGIE_AUTONOME`) ET que
 * `MODE_DEVELOPPEMENT` est vrai. Un hôte AIDA fournit le défaut `message` :
 * ce service n'y est jamais sollicité.
 *
 * Les identifiants restent côté serveur (`DEV_CONNEXION_AUTO_*` de
 * `.env.development.local`) ; la route ne rend que les jetons, posés ici par
 * `AuthService.ouvrirSession`.
 *
 * - 404 (route absente hors `next dev`, variables non posées), autre erreur,
 *   jetons illisibles : `false`, et l'ÉCHEC est mémorisé pour la durée de la
 *   page — on ne redemande pas à chaque navigation, `/connexion` prend le relais.
 * - Succès : rien n'est mémorisé ; après une déconnexion, une nouvelle page
 *   protégée rouvre la session.
 * - Appels simultanés : une seule requête en vol.
 *
 * Le `HttpClient` est celui de la RACINE (sans nos intercepteurs) : il n'y a
 * pas encore de jeton à poser, et un refus ne doit pas passer par
 * l'intercepteur de session expirée.
 */
@Injectable({ providedIn: 'root' })
export class ConnexionAutoService {
  private readonly http = inject(HttpClient);
  private readonly injecteur = inject(Injector);
  private echoue = false;
  private enVol: Promise<boolean> | null = null;

  tenter(): Promise<boolean> {
    if (this.echoue) return Promise.resolve(false);
    this.enVol ??= this.executer().then((ok) => {
      if (!ok) this.echoue = true;
      this.enVol = null;
      return ok;
    });
    return this.enVol;
  }

  private async executer(): Promise<boolean> {
    try {
      const base = this.injecteur.get(ConfigService).valeur.apiBaseUrl.replace(/\/+$/, '');
      const jetons = await firstValueFrom(this.http.post<JetonsSession>(`${base}${CHEMIN_CONNEXION_AUTO}`, null));
      const acces = jetons?.access_token;
      const rafraichissement = jetons?.refresh_token;
      if (typeof acces !== 'string' || typeof rafraichissement !== 'string' || !acces || !rafraichissement) return false;
      return await this.injecteur.get(AuthService).ouvrirSession(acces, rafraichissement);
    } catch {
      return false;
    }
  }
}
