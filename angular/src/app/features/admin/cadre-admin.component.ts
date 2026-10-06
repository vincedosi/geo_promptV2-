import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RoleAdminService } from './etat/role-admin.service';

/** Textes du refus, exportés pour les tests. */
export const MESSAGE_ACCES_REFUSE = 'Accès réservé aux super-administrateurs.';
export const MESSAGE_ROLE_ILLISIBLE = 'Impossible de vérifier vos droits.';

/**
 * Racine de la route `admin` (arbitrage C2) : n'ouvre son `<router-outlet>` qu'au
 * `super_admin`. Sinon un message À LA PLACE des pages — aucune page admin n'est créée, donc
 * aucun appel d'API ne part — et AUCUNE navigation : même comportement dans un hôte (l'URL du
 * shell ne bouge pas) et en autonome. React n'a pas d'équivalent : il affiche la page et laisse
 * chaque appel répondre 401/403.
 *
 * `chargement` ne rend rien : le garde `roleResoluGuard` a attendu la lecture, cet état n'est
 * visible qu'à une relecture (changement de compte, « Réessayer »).
 */
@Component({
  selector: 'mg-cadre-admin',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (role.etat()) {
      @case ('super_admin') {
        <router-outlet />
      }
      @case ('refuse') {
        <p role="status" class="m-0 rounded-lg border-fin border-subtle bg-surface p-4 text-[13px] text-secondary">{{ messageRefuse }}</p>
      }
      @case ('erreur') {
        <div role="alert" class="flex items-center gap-4 rounded-lg border-fin border-subtle bg-surface p-4">
          <p class="m-0 text-[13px] text-secondary">{{ messageIllisible }}</p>
          <button
            type="button"
            class="ml-auto cursor-pointer rounded-lg border-fin border-default bg-transparent px-4 py-2 text-[12px] font-medium text-secondary transition-colors duration-200 hover:border-hover hover:bg-elevated hover:text-primary"
            (click)="reessayer()"
          >Réessayer</button>
        </div>
      }
    }
  `,
  host: { class: 'block' },
})
export class CadreAdminComponent {
  protected readonly role = inject(RoleAdminService);
  protected readonly messageRefuse = MESSAGE_ACCES_REFUSE;
  protected readonly messageIllisible = MESSAGE_ROLE_ILLISIBLE;

  protected reessayer(): void {
    void this.role.reessayer();
  }
}
