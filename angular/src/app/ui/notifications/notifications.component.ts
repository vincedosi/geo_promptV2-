import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconeComponent } from '../icone/icone.component';
import type { NomIcone } from '../icone/icones';
import { NotificationsService, type VarianteNotification } from './notifications.service';

/** `VARIANTS` de geo-toast.tsx : couleur (jeton) et icône lucide de chaque variante. */
const VARIANTES: Record<VarianteNotification, { couleur: string; icone: NomIcone }> = {
  success: { couleur: 'var(--success)', icone: 'coche' },
  error: { couleur: 'var(--danger)', icone: 'croix' },
  warning: { couleur: 'var(--warning)', icone: 'triangle-alerte' },
  info: { couleur: 'var(--brand-teal)', icone: 'info' },
};

/**
 * Pile de notifications, rendu de `ToastCard` (`components/ui/geo-toast.tsx`), lue dans le
 * `NotificationsService` de l'injecteur (fourni par le cadre qui la monte).
 *
 * N'est PAS positionnée : React la posait en `position: fixed` en haut à droite, interdit dans la
 * racine d'ombre. Le parent la place (rangée `sticky` de hauteur nulle, arbitrage C7).
 *
 * Barre de temps : une animation CSS de 4 s au lieu de la boucle `requestAnimationFrame` de React —
 * même rendu (largeur 100 % → 0, linéaire), figée pendant la sortie comme chez React.
 */
@Component({
  selector: 'mg-notifications',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div role="status" aria-live="polite" class="pointer-events-none flex flex-col gap-2">
      @for (n of service.notifications(); track n.id) {
        <div
          data-notification
          [attr.data-variante]="n.variante"
          class="carte"
          [class.sortie]="n.sortie"
          [style.--couleur]="variantes[n.variante].couleur"
        >
          <div class="flex items-start gap-2.5 px-4 py-3">
            <mg-icone
              data-role="variante"
              [attr.data-nom]="variantes[n.variante].icone"
              [nom]="variantes[n.variante].icone"
              [taille]="16"
              [trait]="2"
              class="mt-px shrink-0 text-[var(--couleur)]"
            />
            <div class="min-w-0 flex-1">
              <div class="text-[13px] font-medium text-primary">{{ n.titre }}</div>
              @if (n.message) {
                <div class="mt-0.5 text-[12px] leading-[1.5] text-secondary">{{ n.message }}</div>
              }
            </div>
            <button
              type="button"
              aria-label="Fermer la notification"
              class="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-tertiary transition-colors duration-150 hover:text-primary"
              (click)="service.retirer(n.id)"
            >
              <mg-icone nom="croix" [taille]="14" />
            </button>
          </div>
          <div class="h-0.5 bg-[var(--border-subtle)]">
            <div class="temps h-full"></div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .carte {
      pointer-events: auto;
      background: var(--bg-surface);
      border: 0.5px solid var(--border-default);
      border-left: 3px solid var(--couleur);
      border-radius: 8px;
      min-width: 280px;
      max-width: 380px;
      overflow: hidden;
      opacity: 1;
      transform: translateX(0) scale(1);
      transition: opacity 260ms cubic-bezier(0.23, 1, 0.32, 1), transform 320ms cubic-bezier(0.32, 0.72, 0, 1);
      animation: entree 320ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    .carte.sortie {
      opacity: 0;
      transform: translateX(100%) scale(0.97);
    }
    @keyframes entree {
      from { opacity: 0; transform: translateX(100%) scale(0.97); }
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    .temps {
      background: var(--couleur);
      opacity: 0.4;
      animation: temps 4000ms linear forwards; /* DUREE_NOTIFICATION */
    }
    .carte.sortie .temps { animation-play-state: paused; }
    @keyframes temps {
      from { width: 100%; }
      to { width: 0%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .carte { animation: none; transition: opacity 150ms linear; }
      .carte.sortie { transform: none; }
    }
  `,
})
export class NotificationsComponent {
  protected readonly service = inject(NotificationsService);
  protected readonly variantes = VARIANTES;
}
