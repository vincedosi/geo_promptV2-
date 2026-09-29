import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { messageErreurConnexion } from './messages';
import { SUPABASE } from './supabase';

/** La session de l'utilisateur, exposée en signals. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE);
  private readonly router = inject(Router);
  private readonly _session = signal<Session | null>(null);

  readonly session = this._session.asReadonly();
  readonly connecte = computed(() => this._session() !== null);
  readonly email = computed(() => this._session()?.user?.email ?? null);

  /** Reprend la session existante (cookie) et suit ses changements. */
  async initialiser(): Promise<void> {
    const { data } = await this.supabase.auth.getSession();
    this._session.set(data.session);
    this.supabase.auth.onAuthStateChange((evt, s) => {
      this._session.set(s);
      // La session peut se terminer côté GoTrue sans passer par deconnecter()
      // (jeton de rafraîchissement révoqué, cookie expiré ailleurs) : on
      // renvoie alors vers /connexion nous-mêmes, SANS rappeler signOut —
      // GoTrue l'a déjà fait, c'est ce qui produit cet événement.
      if (evt === 'SIGNED_OUT') void this.redirigerVersConnexion();
    });
  }

  /** @returns un message d'erreur en français, ou `null` si la connexion a réussi. */
  async connecter(email: string, motDePasse: string): Promise<string | null> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password: motDePasse });
    return error ? messageErreurConnexion(error.message) : null;
  }

  async deconnecter(): Promise<void> {
    // supabase-js ne lève pas : signOut() RENVOIE { error } au lieu de
    // rejeter. Sans ce repli, un signOut réseau en échec laisse le cookie en
    // place — la page a l'air déconnectée (signal à null) alors que la
    // session tient toujours côté serveur.
    const { error } = await this.supabase.auth.signOut();
    if (error) await this.supabase.auth.signOut({ scope: 'local' });
    this._session.set(null);
  }

  /**
   * Termine la session LOCALEMENT et renvoie vers /connexion, avec la page
   * courante à reprendre après reconnexion. Point d'entrée unique pour toute
   * fin de session survenant EN COURS de page (401 API via
   * sessionExpireeInterceptor, ou appelée directement) — avant, seul le garde
   * de route agissait, donc un rafraîchissement en cours de page laissait
   * l'utilisateur bloqué sur l'écran d'erreur sans moyen d'en sortir.
   */
  async renvoyerVersConnexion(): Promise<void> {
    await this.supabase.auth.signOut({ scope: 'local' });
    this._session.set(null);
    await this.redirigerVersConnexion();
  }

  private async redirigerVersConnexion(): Promise<void> {
    if (this.router.url.startsWith('/connexion')) return;
    await this.router.navigate(['/connexion'], { queryParams: { redirection: this.router.url } });
  }

  /**
   * Le jeton d'accès courant. getSession() lit la session en LOCAL et
   * n'appelle GoTrue que si le jeton a expiré, pour le rafraîchir. C'est la
   * DÉ-DUPLICATION des rafraîchissements concurrents par supabase-js — et non
   * l'absence d'appel réseau, qui n'est vraie que sur un jeton encore valide
   * — qui protège de l'incident du 28/03 (409 sur des appels simultanés).
   */
  async jeton(): Promise<string | null> {
    const { data } = await this.supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
}
