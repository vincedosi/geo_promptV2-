import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';

/**
 * L'accordéon de GROUPE du panneau Calques — portage de `app/map/_components/panneaux/GroupeCalques.tsx`.
 *
 * Seul composant du panneau à rendre un chevron de groupe (`chevron-droite` fermé, `chevron-bas` ouvert, 14 px,
 * `--text-tertiary`, poussé à droite). Le badge de compte, masqué à 0, est le teal à 15 % (`rgba(78,205,196,0.15)`
 * de React, par mélange : le teal est invariant, la valeur est exacte). Le contenu n'est rendu qu'ouvert.
 */
@Component({
  selector: 'mg-groupe-calques',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block border-t-fin border-subtle' },
  template: `
    <button
      type="button"
      data-groupe
      [attr.aria-expanded]="ouvert()"
      (click)="basculer.emit()"
      class="flex w-full cursor-pointer items-center gap-2 border-0 bg-elevated px-[14px] py-[10px] text-left"
    >
      <span class="flex-1 text-[12px] font-medium text-primary">{{ titre() }}</span>
      @if (compte() > 0) {
        <span
          data-compte
          class="rounded-[4px] bg-[color-mix(in_srgb,var(--brand-teal)_15%,transparent)] px-1.5 py-px font-mono text-[10px] leading-[1.4] text-teal"
        >{{ compte() }}</span>
      }
      <mg-icone [nom]="ouvert() ? 'chevron-bas' : 'chevron-droite'" [taille]="14" class="ml-auto shrink-0 text-tertiary" />
    </button>
    @if (ouvert()) {
      <div data-contenu><ng-content /></div>
    }
  `,
})
export class GroupeCalquesComponent {
  readonly titre = input.required<string>();
  readonly ouvert = input.required<boolean>();
  /** Nombre de calques actifs du groupe — badge masqué à 0. */
  readonly compte = input(0);
  readonly basculer = output<void>();
}
