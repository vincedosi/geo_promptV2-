import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { ENTREES_NAVIGATION, LARGEUR_RAIL, type EntreeId, type EntreeNavigation } from '../logique/navigation';

/** Libellé des entrées inertes, patron « Disponible prochainement » du lot Rendu. */
export const PROCHAINEMENT = 'Disponible prochainement';

/**
 * L'Assistant n'est JAMAIS porté (décision du propriétaire, 2026-10-04) : son entrée est retirée AU
 * RENDU, et la copie `logique/navigation.ts` reste verbatim (verrou de parité avec React).
 */
/**
 * Entrées présentes mais INERTES : Campagne relève du lot 5 (arbitrage B6) — rendue à l'identique
 * (bouton teal pleine largeur), sans effet, avec la mention « Disponible prochainement ».
 */
const INERTES: ReadonlySet<EntreeId> = new Set(['campagne']);

type EntreeRail = EntreeNavigation & { readonly inerte: boolean };
const AFFICHEES: readonly EntreeRail[] = ENTREES_NAVIGATION
  .filter((e) => e.id !== 'assistant')
  .map((e) => ({ ...e, inerte: INERTES.has(e.id) }));
const HAUT = AFFICHEES.filter((e) => e.position === 'haut');
const BAS = AFFICHEES.filter((e) => e.position === 'bas');

/**
 * Le rail vertical de la carte — portage de `components/map/RailNavigation.tsx`.
 *
 * `position: fixed` en React ; ici `absolute` dans l'hôte `relative` de la page (arbitrage B1) :
 * `fixed` dans une racine d'ombre se poserait sur la fenêtre du SHELL. Même `z-index` relatif (30) :
 * le rail passe SOUS la barre du haut (45) et sous le panneau (40), comme en React.
 *
 * Le routage d'une entrée (panneau, inerte) est décidé par l'appelant (`EtatCarteService.choisirEntree`),
 * comme `onEntree` en React ; les entrées inertes n'émettent rien.
 */
@Component({
  selector: 'mg-rail',
  imports: [IconeComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'rail-navigation absolute bottom-0 left-0 top-0 z-30 flex flex-col items-center gap-1 border-r-fin border-subtle bg-surface py-3 transition-transform duration-200 ease-[var(--ease-out)]',
    '[style.width.px]': 'largeur',
    '[style.transform]': "masque() ? 'translateX(-100%)' : 'translateX(0)'",
    '[attr.data-hidden]': "masque() ? 'true' : 'false'",
    role: 'navigation',
    'aria-label': 'Navigation de la carte',
  },
  template: `
    <ng-template #entree let-e>
      @if (e.accent) {
        <button
          type="button"
          [attr.data-entree]="e.id"
          [attr.aria-label]="e.label"
          [attr.aria-pressed]="actif() === e.id"
          [attr.aria-disabled]="e.inerte ? 'true' : null"
          [attr.title]="e.inerte ? prochainement : (e.tooltip || null)"
          (click)="cliquer(e)"
          class="relative flex h-14 flex-col items-center justify-center gap-1 rounded-[8px] border-0 bg-teal p-0 text-teal-fg"
          [class.cursor-pointer]="!e.inerte"
          [class.cursor-default]="e.inerte"
          [style.width.px]="largeurBouton"
        >
          <mg-icone [nom]="e.icone" [taille]="20" [trait]="1.5" />
          <span class="text-center text-[10px] leading-[1.2] font-medium">{{ e.label }}</span>
        </button>
      } @else {
        <button
          type="button"
          [attr.data-entree]="e.id"
          [attr.aria-label]="e.label"
          [attr.aria-pressed]="actif() === e.id"
          [attr.title]="e.tooltip || null"
          (click)="cliquer(e)"
          class="relative flex h-12 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[8px] border-0 p-0 transition-[background-color,color] duration-150 ease-[var(--ease-hover)]"
          [class]="actif() === e.id ? classeActive : classeInactive"
          [style.width.px]="largeurBouton"
        >
          @if (actif() === e.id) {
            <span data-indicateur class="absolute bottom-2 left-[-4px] top-2 w-[3px] rounded-r-[2px] bg-teal"></span>
          }
          <span class="relative flex">
            <mg-icone [nom]="e.icone" [taille]="20" [trait]="1.5" />
          </span>
          <span class="text-center text-[10px] leading-[1.2] font-medium tracking-[0.01em]">{{ e.label }}</span>
        </button>
      }
      @if (e.separateurApres) {
        <div data-separateur class="my-1 h-[0.5px] w-6 bg-subtle"></div>
      }
    </ng-template>

    @for (e of haut; track e.id) {
      <ng-container *ngTemplateOutlet="entree; context: { $implicit: e }" />
    }
    <div class="mt-auto flex flex-col items-center gap-1" data-bas>
      @for (e of bas; track e.id) {
        <ng-container *ngTemplateOutlet="entree; context: { $implicit: e }" />
      }
    </div>
  `,
})
export class RailComponent {
  readonly actif = input<EntreeId | null>(null);
  readonly masque = input(false);
  readonly choisir = output<EntreeId>();

  protected readonly haut = HAUT;
  protected readonly bas = BAS;
  protected readonly largeur = LARGEUR_RAIL;
  protected readonly largeurBouton = LARGEUR_RAIL - 8;
  protected readonly prochainement = PROCHAINEMENT;
  // React : `rgba(78,205,196,0.12)` — le teal de marque à 12 %, par mélange plutôt qu'en littéral.
  protected readonly classeActive = 'bg-[color-mix(in_srgb,var(--brand-teal)_12%,transparent)] text-teal';
  protected readonly classeInactive = 'bg-transparent text-tertiary hover:bg-elevated';

  protected cliquer(e: EntreeRail): void {
    if (e.inerte) return;
    this.choisir.emit(e.id);
  }
}
