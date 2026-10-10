import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { teinteLigneV1, teinteLigneV2 } from '../../logique/bataille/journal';
import { TEXTE_TEINTE } from './styles-analyse';

/**
 * Le journal « terminal » d'une bataille — le bloc que `IsochronesTool.tsx:268-287` et `BattleV2Tool.tsx:246-265`
 * écrivaient deux fois : police mono 10 px, une couleur par ligne selon son préfixe (règles V1 ou V2), le curseur
 * « ▌ » pendant le calcul. Fixe, comme le rendu RÉEL de React : son `animation: 'fpBlink …'` nomme une `@keyframes`
 * définie nulle part dans le dépôt, le curseur n'y a donc jamais clignoté.
 */
@Component({
  selector: 'mg-journal-bataille',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div data-journal class="flex flex-col gap-px overflow-y-auto rounded-[4px] border-fin border-default bg-[var(--bg-primary)] px-[10px] py-2 font-mono text-[10px] leading-[1.7] text-tertiary"
      [style.max-height.px]="hauteurMax()">
      @for (l of lignes(); track $index) {
        <div [class]="l.classe">{{ l.texte }}</div>
      }
      @if (enCours()) {
        <div [class]="curseur()">▌</div>
      }
    </div>
  `,
})
export class JournalBatailleComponent {
  readonly journal = input.required<readonly string[]>();
  /** Les règles de couleur : celles de la V1 ou de la V2. */
  readonly variante = input.required<'v1' | 'v2'>();
  readonly enCours = input(false);
  readonly hauteurMax = input(120);

  protected readonly lignes = computed(() => {
    const teinte = this.variante() === 'v1' ? teinteLigneV1 : teinteLigneV2;
    return this.journal().map((texte) => ({ texte, classe: TEXTE_TEINTE[teinte(texte)] }));
  });
  /** Le curseur est tertiaire en V1, secondaire en V2 (`C.textDim` / `C.textSec`). */
  protected readonly curseur = computed(() => (this.variante() === 'v1' ? 'text-tertiary' : 'text-secondary'));
}
