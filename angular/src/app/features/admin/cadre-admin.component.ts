import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationsComponent } from '../../ui/notifications/notifications.component';
import { NotificationsService } from '../../ui/notifications/notifications.service';
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
 * Refus et erreur sont décalés de 32 px (`pt-8`, une marge fondrait avec celle de la rangée des
 * notifications) : sans en-tête de page au-dessus, ils passaient SOUS le chrome du
 * haut (badge de session à cheval sur leur bordure, réserve de T1).
 *
 * Fournit aussi le `NotificationsService` des pages admin (C7), détruit avec le cadre.
 *
 * `chargement` ne rend rien : le garde `roleResoluGuard` a attendu la lecture, cet état n'est
 * visible qu'à une relecture (changement de compte, « Réessayer »).
 */
@Component({
  selector: 'mg-cadre-admin',
  imports: [RouterOutlet, NotificationsComponent],
  providers: [NotificationsService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Notifications (C7) : React les épinglait à 12 px du coin haut-droit de la fenêtre,
         ce que la racine d'ombre interdit. Rangée collante (patron du chrome de la coquille) :
         -mt-8 annule la marge p-8 de la coquille pour la coller au haut du défilement, donc 12 px
         du haut comme React, et visible quand on défile. Haute de 1 px et non 0 : une boîte vide
         de hauteur nulle laisse ses marges haute et basse se fondre (-32 + 32 = 0) et ne monte pas
         (mesuré : 44 px au lieu de 12) ; mb-[31px] rend le pixel. z 300 : au-dessus
         du chrome (z 200), comme le z 10000 de React. -->
    <div data-rangee-notifications class="sticky top-0 z-[300] -mt-8 mb-[31px] h-px">
      <mg-notifications class="absolute top-3 -right-5" />
    </div>
    @switch (role.etat()) {
      @case ('super_admin') {
        <router-outlet />
      }
      @case ('refuse') {
        <div class="pt-8">
          <p data-refus role="status" class="m-0 rounded-lg border-fin border-subtle bg-surface p-4 text-[13px] text-secondary">{{ messageRefuse }}</p>
        </div>
      }
      @case ('erreur') {
        <div class="pt-8">
          <div data-refus role="alert" class="flex items-center gap-4 rounded-lg border-fin border-subtle bg-surface p-4">
            <p class="m-0 text-[13px] text-secondary">{{ messageIllisible }}</p>
            <button
              type="button"
              class="ml-auto cursor-pointer rounded-lg border-fin border-default bg-transparent px-4 py-2 text-[12px] font-medium text-secondary transition-colors duration-200 hover:border-hover hover:bg-elevated hover:text-primary"
              (click)="reessayer()"
            >Réessayer</button>
          </div>
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
