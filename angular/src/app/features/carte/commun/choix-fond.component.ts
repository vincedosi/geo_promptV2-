import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MAP_STYLES } from '../logique/fonds';

/**
 * Le choix du fond de carte (tiroir « Fond de carte » de la boîte à outils, T5) — la section Fond des Réglages, sortie en
 * composant ; le sélecteur compact « FOND » posé sur la carte est retiré. La page recrée la carte (B11). Le fond courant
 * est marqué par son ID et non par son URL : « Clair » et « dentsu » partagent Positron (défaut React corrigé).
 */
@Component({
  selector: 'mg-choix-fond',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'grid grid-cols-2 gap-1.5 px-3.5 py-3' },
  template: `
    @for (s of fonds; track s.id) {
      <button type="button" [attr.data-fond]="s.id" [attr.aria-pressed]="s.id === fond()" (click)="choisirFond.emit(s.id)"
        class="cursor-pointer rounded-[6px] border-fin px-2.5 py-2 font-sans text-[11px] transition-[background-color,border-color,color] duration-150 ease-[var(--ease-hover)]"
        [class]="s.id === fond() ? 'border-teal bg-teal-10 text-teal' : 'border-default bg-transparent text-secondary'">{{ s.label }}</button>
    }
  `,
})
export class ChoixFondComponent {
  /** L'id du fond courant (`MAP_STYLES[].id`). */
  readonly fond = input.required<string>();
  readonly choisirFond = output<string>();
  protected readonly fonds = MAP_STYLES;
}
