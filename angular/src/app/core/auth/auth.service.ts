import { Injectable, computed, inject, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { messageErreurConnexion } from './messages';
import { SUPABASE } from './supabase';

/** Portée d'une déconnexion : `globale` révoque côté GoTrue, `locale` n'efface que la session du navigateur. */
export type PorteeDeconnexion = 'globale' | 'locale';

/**
 * La session de l'utilisateur, exposée en signals, et les actions qui la
 * changent. **Ce service ne NAVIGUE JAMAIS.**
 *
 * Il est `providedIn: 'root'`, donc il ne voit pas `STRATEGIE_SANS_SESSION`
 * fournie par la route `app` du lancement autonome : il ne peut pas savoir
 * s'il tourne dans un hôte AIDA (qui n'a pas de page `/connexion`) ou seul.
 * Toute décision « que faire sans session » vit dans le code à portée de
 * route : `authGuard`, la coquille, et `RacineDistanteComponent`, qui réagit à
 * `connecte()` (fin de session par GoTrue, par un 401, ou par l'utilisateur).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE);
  private readonly _session = signal<Session | null>(null);
  /** Plusieurs appels en 401 au même moment : un seul signOut local. */
  private fermetureLocale: Promise<void> | null = null;

  readonly session = this._session.asReadonly();
  readonly connecte = computed(() => this._session() !== null);
  readonly email = computed(() => this._session()?.user?.email ?? null);

  /**
   * Reprend la session existante (cookie) et suit ses changements. Une session
   * terminée côté GoTrue (jeton de rafraîchissement révoqué, cookie expiré
   * ailleurs) émet `SIGNED_OUT` : on se contente de la mettre à null — c'est à
   * la racine de décider d'un message ou d'une redirection.
   */
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

  /**
   * - `globale` (défaut, geste de l'utilisateur) : révoque la session côté
   *   GoTrue. supabase-js ne lève pas : signOut() RENVOIE `{ error }`. Sans le
   *   repli local, un signOut réseau en échec laisserait le cookie en place —
   *   la page aurait l'air déconnectée alors que la session tient toujours.
   * - `locale` (session expirée, 401 de l'API) : efface la session du
   *   navigateur seulement — le jeton est déjà refusé, inutile de le présenter
   *   à GoTrue. Plusieurs appels simultanés partagent le même signOut ; un
   *   appel ultérieur en refait un.
   */
  async deconnecter(portee: PorteeDeconnexion = 'globale'): Promise<void> {
    if (portee === 'locale') {
      this.fermetureLocale ??= (async () => {
        try {
          await this.supabase.auth.signOut({ scope: 'local' });
          this._session.set(null);
        } finally {
          this.fermetureLocale = null;
        }
      })();
      return this.fermetureLocale;
    }
    const { error } = await this.supabase.auth.signOut();
    if (error) await this.supabase.auth.signOut({ scope: 'local' });
    this._session.set(null);
  }

  /**
   * Le rôle du profil en base (`profiles.role`, lecture autorisée par la RLS
   * `id = auth.uid()`), comme `fetchProfileEnrichment` de `lib/auth-client.ts`
   * côté React. `null` si la lecture échoue ou ne rend rien : l'appelant se
   * replie sur le rôle du jeton — l'écran ne reste jamais bloqué dessus.
   */
  async lireRole(): Promise<string | null> {
    return (await this.lireProfil())?.role ?? null;
  }

  /**
   * Rôle ET nom complet du profil (`fetchProfileEnrichment`, `lib/auth-client.ts:93-114`),
   * en une lecture. Même repli que `lireRole` : `null` si la lecture échoue.
   */
  async lireProfil(): Promise<{ role: string | null; nom: string | null } | null> {
    const id = this._session()?.user?.id;
    if (!id) return null;
    try {
      const { data, error } = await this.supabase.from('profiles').select('role, full_name').eq('id', id).single();
      if (error || !data) return null;
      const p = data as { role?: string | null; full_name?: string | null };
      return { role: p.role ?? null, nom: p.full_name ?? null };
    } catch {
      return null;
    }
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
