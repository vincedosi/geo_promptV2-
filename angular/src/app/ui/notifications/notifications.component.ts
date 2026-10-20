import { ChangeDetectionStrategy, Component, ElementRef, effect, inject } from '@angular/core';
import { IconeComponent } from '../icone/icone.component';
import type { NomIcone } from '../icone/icones';
import { DUREE_NOTIFICATION, NotificationsService, type VarianteNotification } from './notifications.service';

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
 * Popover MANUEL (vague finale du lot 6, A2) : React la posait en `position: fixed` en haut à droite,
 * ce que la racine d'ombre interdit d'écrire. L'API popover la met dans la couche supérieure, où le
 * navigateur la positionne lui-même ; on ne fait que la caler à 12 px du coin haut-droit par
 * `inset`/`margin`. Avant, une rangée collante du cadre la plaçait : sous un `<dialog>` modal, elle
 * restait derrière le voile (constat T20, I-1). Chaque poussée la referme puis la rouvre : la couche
 * supérieure est une pile, et un modal ouvert APRÈS elle passerait sinon au-dessus.
 *
 * Elle reste INERTE sous un modal (spécification HTML : tout ce qui n'est pas le modal l'est), donc
 * hors de l'arbre d'accessibilité et non cliquable : elle n'est là que pour être VUE. Une erreur
 * née dans un dialogue s'affiche DANS le dialogue (A1), jamais seulement ici.
 *
 * L'hôte laisse passer les clics (`pointer-events: none`) : seules les cartes les reçoivent, et les
 * interstices de 8 px entre elles n'interceptent plus rien (A5).
 *
 * Barre de temps : une animation CSS de 4 s au lieu de la boucle `requestAnimationFrame` de React —
 * même rendu (largeur 100 % → 0, linéaire), figée pendant la sortie comme chez React.
 */
@Component({
  selector: 'mg-notifications',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { popover: 'manual', 'data-pile-notifications': '' },
  template: `
    <div role="status" aria-live="polite" class="pointer-events-none flex flex-col gap-2" [style.--duree.ms]="duree">
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
    :host {
      inset: 12px 12px auto auto;
      margin: 0;
      border: 0;
      padding: 0;
      background: transparent;
      overflow: visible;
      pointer-events: none;
    }
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
      animation: temps var(--duree) linear forwards; /* DUREE_NOTIFICATION, lié par le gabarit */
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
  protected readonly duree = DUREE_NOTIFICATION;

  constructor() {
    const hote = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let derniere = 0;
    let ouverte = false;
    effect(() => {
      const liste = this.service.notifications();
      // API absente (jsdom, navigateur d'avant 2024) : la pile reste en place, sans couche supérieure.
      if (typeof hote.showPopover !== 'function') return;
      if (liste.length === 0) {
        if (ouverte) hote.hidePopover();
        ouverte = false;
        return;
      }
      const plusRecente = liste[liste.length - 1].id;
      if (plusRecente <= derniere) return;
      derniere = plusRecente;
      if (ouverte) hote.hidePopover();
      hote.showPopover();
      ouverte = true;
    });
  }
}
