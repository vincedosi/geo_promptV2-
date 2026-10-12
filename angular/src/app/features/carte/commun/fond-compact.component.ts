import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MAP_STYLES } from '../logique/fonds';

/**
 * Le sélecteur compact « FOND » posé sur la carte — portage de `app/map/_components/MapPanel.tsx:255-287`
 * (bas droite, au-dessus du contrôle de zoom). Projeté DANS `mg-carte`, en `absolute`, comme le badge de zoom.
 * Libellés : les trois premières lettres de chaque fond (« Sta », « OSM », « Cla », « MAG »).
 *
 * Défaut React corrigé : React marque l'actif par l'URL, et « Clair » et « MAGELIAN » partagent celle de
 * Positron — les deux s'allumaient ensemble. Ici l'actif est l'id du fond.
 */
@Component({
  selector: 'mg-fond-compact',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute bottom-[28px] right-[12px] z-10 flex flex-row items-center gap-0.5' },
  template: `
    <span class="mr-1 font-mono text-[9px] tracking-[0.06em] text-secondary">FOND</span>
    @for (s of fonds; track s.id) {
      <button
        type="button"
        [attr.data-fond-compact]="s.id"
        [attr.title]="s.label"
        [attr.aria-pressed]="s.id === fond()"
        (click)="choisirFond.emit(s.id)"
        class="cursor-pointer rounded-[4px] border-fin px-2 py-[3px] font-sans text-[9px] leading-normal transition-all duration-200 ease-[ease] hover:scale-[1.06]"
        [class]="s.id === fond() ? 'border-teal bg-teal text-page' : 'border-default bg-transparent text-secondary'"
      >{{ s.court }}</button>
    }
  `,
})
export class FondCompactComponent {
  readonly fond = input.required<string>();
  readonly choisirFond = output<string>();
  protected readonly fonds = MAP_STYLES.map((s) => ({ id: s.id, label: s.label, court: s.label.slice(0, 3) }));
}
