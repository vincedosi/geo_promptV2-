import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { teinteLigneV2 } from '../../logique/bataille/journal';
import { TEXTE_TEINTE } from './styles-analyse';

/**
 * Le journal « terminal » de la bataille V2 — le bloc de `BattleV2Tool.tsx:246-265` (la variante V1 est partie avec
 * l'outil, 27/10) : police mono 10 px, une couleur par ligne selon son préfixe (`teinteLigneV2`), le curseur
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
        <div class="text-secondary">▌</div>
      }
    </div>
  `,
})
export class JournalBatailleComponent {
  readonly journal = input.required<readonly string[]>();
  readonly enCours = input(false);
  readonly hauteurMax = input(120);

  protected readonly lignes = computed(() => {
    return this.journal().map((texte) => ({ texte, classe: TEXTE_TEINTE[teinteLigneV2(texte)] }));
  });
}
