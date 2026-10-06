import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

/** Ce que l'administration sait du droit de l'utilisateur courant. */
export type EtatRoleAdmin = 'chargement' | 'super_admin' | 'refuse' | 'erreur';

/**
 * Le rôle de l'utilisateur, lu UNE fois par session pour toute l'administration (arbitrage C2).
 *
 * React ne contrôle RIEN côté client : un `client` ouvre `/admin/users`, la page s'affiche et
 * chaque appel répond 401/403 (`requireAdmin` = super_admin STRICT, `lib/api/middleware.ts:19-23`).
 * Ici, `CadreAdminComponent` n'ouvre son `<router-outlet>` qu'au `super_admin`.
 *
 * ⚠ `AuthService.lireRole()` rend `null` dans DEUX cas qu'il faut distinguer : lecture de
 * `profiles` en ÉCHEC, et profil présent SANS rôle. On lit donc `lireProfil()` : `null` = la
 * lecture a échoué → `erreur` (on propose de réessayer, on ne conclut pas au refus) ; profil
 * présent dont le rôle n'est pas `super_admin` (y compris un rôle vide) → `refuse`.
 *
 * Relu quand l'IDENTIFIANT de session change (connexion avec un autre compte, y compris dans un
 * hôte, sans navigation) — jamais à chaque page, ni au simple rafraîchissement du jeton (même
 * identifiant). Fourni par la route `admin` (`FOURNISSEURS_ADMIN`), jamais `providedIn: 'root'`.
 */
@Injectable()
export class RoleAdminService {
  private readonly auth = inject(AuthService);
  private readonly _etat = signal<EtatRoleAdmin>('chargement');
  readonly etat = this._etat.asReadonly();

  /** Identifiant de la dernière lecture lancée ; `undefined` = jamais lancée. */
  private cle: string | null | undefined = undefined;
  private enVol: Promise<void> | null = null;

  constructor() {
    effect(() => {
      const id = this.identifiant();
      untracked(() => {
        if (this.cle !== undefined && id !== this.cle) void this.lire(id);
      });
    });
  }

  /** Idempotent tant que la session ne change pas ; jamais plus d'une lecture de `profiles` en vol. */
  charger(): Promise<void> {
    const id = this.identifiant();
    if (this.cle === id) return this.enVol ?? Promise.resolve();
    return this.lire(id);
  }

  /** Relit le rôle (après un échec de lecture) ; rejoint la lecture en vol s'il y en a une. */
  reessayer(): Promise<void> {
    const id = this.identifiant();
    if (this.enVol && this.cle === id) return this.enVol;
    return this.lire(id);
  }

  private identifiant(): string | null {
    return this.auth.session()?.user?.id ?? null;
  }

  private lire(id: string | null): Promise<void> {
    this.cle = id;
    this._etat.set('chargement');
    // Sans session, rien à lire : la racine distante affiche « Session requise… » ou redirige.
    if (id === null) {
      this.enVol = null;
      return Promise.resolve();
    }
    const promesse: Promise<void> = (async () => {
      let etat: EtatRoleAdmin;
      try {
        const profil = await this.auth.lireProfil();
        etat = profil === null ? 'erreur' : profil.role === 'super_admin' ? 'super_admin' : 'refuse';
      } catch {
        etat = 'erreur';
      }
      // Une lecture dépassée (la session a changé entre-temps) n'écrit rien.
      if (this.cle === id) this._etat.set(etat);
    })().finally(() => {
      if (this.enVol === promesse) this.enVol = null;
    });
    this.enVol = promesse;
    return promesse;
  }
}

/**
 * Garde de la route `admin` : attend que le rôle soit RÉSOLU, puis laisse TOUJOURS passer (C2).
 * Il ne navigue jamais — c'est le cadre qui affiche le refus — : le comportement est le même
 * dans un hôte (l'URL du shell ne bouge pas) et en autonome.
 */
export const roleResoluGuard: CanActivateFn = async () => {
  await inject(RoleAdminService).charger();
  return true;
};
