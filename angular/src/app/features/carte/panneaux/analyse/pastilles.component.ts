import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { PASTILLE, PASTILLE_INACTIVE, PASTILLE_PRIMAIRE_ACTIVE } from './styles-analyse';

/** Une option : sa valeur, son libellé, et sa `cle` (attribut `data-pastille`, pour les specs). */
export interface OptionPastille<T> {
  readonly cle: string;
  readonly valeur: T;
  readonly libelle: string;
}

/** Un groupe de pastilles exclusives de ④ (découpage, détail par champ, « Sur », sens d'un indicateur) : une valeur, `aria-pressed`. */
@Component({
  selector: 'mg-pastilles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex gap-[5px]" role="group" [attr.aria-label]="libelle()">
      @for (o of options(); track o.cle) {
        <button type="button" [attr.data-pastille]="marque() === 'pastille' ? o.cle : null" [attr.data-sens]="marque() === 'sens' ? o.cle : null" [attr.aria-pressed]="o.valeur === valeur()" (click)="valeur.set(o.valeur)"
          [class]="pastille + ' flex-1 text-center ' + (o.valeur === valeur() ? actif : inactif)">{{ o.libelle }}</button>
      }
    </div>
  `,
})
export class PastillesComponent<T> {
  readonly options = input.required<readonly OptionPastille<T>[]>();
  readonly valeur = model.required<T>();
  /** Le libellé accessible du groupe. */
  readonly libelle = input.required<string>();
  /** L'attribut qui porte la `cle` : `data-pastille` (défaut) ou `data-sens` (sens d'un indicateur du score, T5). */
  readonly marque = input<'pastille' | 'sens'>('pastille');
  protected readonly pastille = PASTILLE;
  protected readonly actif = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly inactif = PASTILLE_INACTIVE;
}
