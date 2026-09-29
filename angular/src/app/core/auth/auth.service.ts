import { Injectable, computed, inject, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { messageErreurConnexion } from './messages';
import { SUPABASE } from './supabase';

/** La session de l'utilisateur, exposée en signals. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE);
  private readonly _session = signal<Session | null>(null);

  readonly session = this._session.asReadonly();
  readonly connecte = computed(() => this._session() !== null);
  readonly email = computed(() => this._session()?.user?.email ?? null);

  /** Reprend la session existante (cookie) et suit ses changements. */
  async initialiser(): Promise<void> {
    const { data } = await this.supabase.auth.getSession();
    this._session.set(data.session);
    this.supabase.auth.onAuthStateChange((_evt, s) => this._session.set(s));
  }

  /** @returns un message d'erreur en français, ou `null` si la connexion a réussi. */
  async connecter(email: string, motDePasse: string): Promise<string | null> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password: motDePasse });
    return error ? messageErreurConnexion(error.message) : null;
  }

  async deconnecter(): Promise<void> {
    await this.supabase.auth.signOut();
    this._session.set(null);
  }

  /**
   * Le jeton d'accès courant, relu à chaque appel : getSession() le rafraîchit
   * s'il a expiré. getSession() est LOCAL (pas d'appel réseau vers GoTrue),
   * donc sans risque de 409 sur des appels simultanés (incident du 28/03).
   */
  async jeton(): Promise<string | null> {
    const { data } = await this.supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
}
