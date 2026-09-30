import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { CHEMIN_CONNEXION } from './chemin-connexion';
import { messageErreurConnexion } from './messages';
import { SUPABASE } from './supabase';

/** La session de l'utilisateur, exposée en signals. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE);
  private readonly router = inject(Router);
  private readonly cheminConnexion = inject(CHEMIN_CONNEXION);
  private readonly _session = signal<Session | null>(null);
  private renvoiEnCours: Promise<void> | null = null;
  private redirectionEnCours: Promise<void> | null = null;
  /**
   * Vrai pendant le `signOut({scope:'local'})` de `renvoyerVersConnexion` :
   * ce signOut ÉMET lui-même SIGNED_OUT (comme le vrai supabase-js), et sans
   * ce garde le handler de `initialiser()` appellerait `redirigerVersConnexion`
   * EN MÊME TEMPS que l'appel explicite qui suit — mesuré : les deux peuvent
   * naviguer, un simple cache de promesse sur `redirigerVersConnexion` ne
   * suffit pas, la redirection du handler pouvant se résoudre (et remettre
   * son propre cache à zéro) AVANT que l'appel explicite n'ait eu l'occasion
   * de le lire, selon l'ordre d'entrelacement des microtâches. Couper le
   * doublon à sa SOURCE — l'événement qu'on a nous-mêmes provoqué — est la
   * seule protection qui ne dépend pas d'un minutage.
   */
  private signOutLocalEnCours = false;

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
      // GoTrue l'a déjà fait, c'est ce qui produit cet événement. Sauf si ce
      // SIGNED_OUT vient du signOut() DE renvoyerVersConnexion lui-même : il
      // s'en charge déjà, juste après.
      if (evt === 'SIGNED_OUT' && !this.signOutLocalEnCours) void this.redirigerVersConnexion();
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
    // Plusieurs appels en vol peuvent échouer en 401 au même moment : un
    // seul renvoi, les autres attendent le même.
    this.renvoiEnCours ??= (async () => {
      try {
        this.signOutLocalEnCours = true;
        try {
          await this.supabase.auth.signOut({ scope: 'local' });
        } finally {
          this.signOutLocalEnCours = false;
        }
        this._session.set(null);
        await this.redirigerVersConnexion();
      } finally {
        this.renvoiEnCours = null;
      }
    })();
    return this.renvoiEnCours;
  }

  /**
   * `redirectionEnCours` réutilise une redirection déjà en vol et la remet à
   * null en `finally` une fois la navigation terminée — une SECONDE fin de
   * session, plus tard, redirige donc bien à nouveau. C'est une DÉFENSE EN
   * PROFONDEUR pour deux déclencheurs vraiment indépendants (deux SIGNED_OUT
   * externes rapprochés, par exemple) : elle NE SUFFIT PAS, seule, contre le
   * doublon `renvoyerVersConnexion` ↔ handler `SIGNED_OUT` décrit sur
   * `signOutLocalEnCours` — mesuré, la redirection du handler peut se
   * résoudre et remettre CE cache à zéro avant que l'appel explicite ne le
   * lise. Le repli « déjà sur /connexion » est traité SANS toucher au cache :
   * le poser malgré tout exposerait la même fenêtre de réaffectation tardive.
   */
  private redirigerVersConnexion(): Promise<void> {
    if (this.redirectionEnCours) return this.redirectionEnCours;
    if (this.router.url.startsWith(this.cheminConnexion)) return Promise.resolve();
    const p = (async () => {
      try {
        // `this.router.url` est l'URL COMPLÈTE (`/app/essai-carte?…` en autonome,
        // préfixe de l'hôte compris dans AIDA) : c'est elle qu'on reprendra.
        await this.router.navigate([this.cheminConnexion], { queryParams: { redirection: this.router.url } });
      } finally {
        this.redirectionEnCours = null;
      }
    })();
    this.redirectionEnCours = p;
    return p;
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
