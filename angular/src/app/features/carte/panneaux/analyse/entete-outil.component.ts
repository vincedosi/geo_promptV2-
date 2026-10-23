import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ENTETE_ACCORDEON } from './styles-analyse';

/** L'en-tête d'accordéon d'un outil de ④ : point teal, titre, chevron (couverture, rayon, score, corrélation). */
@Component({
  selector: 'mg-entete-outil',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button type="button" data-entete-outil [attr.aria-expanded]="ouvert()" (click)="basculer.emit()" [class]="entete">
      <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
      <span class="flex-1 text-left text-[12px] font-medium text-primary">{{ titre() }}</span>
      <span class="text-[10px] text-tertiary">{{ ouvert() ? '▲' : '▼' }}</span>
    </button>
  `,
})
export class EnteteOutilComponent {
  readonly titre = input.required<string>();
  readonly ouvert = input.required<boolean>();
  readonly basculer = output();
  protected readonly entete = ENTETE_ACCORDEON;
}
