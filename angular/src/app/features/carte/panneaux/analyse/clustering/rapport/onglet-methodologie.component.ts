import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FEAT_LABEL } from '../../../../logique/clustering/libelles';
import { etapesMethodologie } from '../../../../logique/clustering/rapport';
import type { DetailModele } from '../../../../logique/clustering/types';
import { STYLES_RAPPORT } from './commun-rapport';

/** Onglet « Méthodologie » (`TabMethodologie`, `ClusterDetails.tsx:875-906`) : les six étapes, puis le glossaire. */
@Component({
  selector: 'mg-onglet-methodologie',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      @for (e of etapes(); track e.titre) {
        <div class="panneau-rapport p-4!">
          <div class="mb-1.5 text-[12px] text-teal">{{ e.titre }}</div>
          <div class="mono text-[11px] leading-[1.6] text-secondary">{{ e.detail }}</div>
        </div>
      }
      <div class="panneau-rapport p-4!">
        <div class="mb-[10px] text-[12px] text-teal">Glossaire des features</div>
        <div class="grid grid-cols-2 gap-1">
          @for (g of glossaire; track g[0]) {
            <div class="ligne-fine flex gap-1.5 py-[3px]">
              <span class="mono min-w-[100px] shrink-0 text-[9px] text-teal">{{ g[0] }}</span>
              <span class="mono text-[9px] text-secondary">{{ g[1] }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: STYLES_RAPPORT,
})
export class OngletMethodologieComponent {
  readonly modele = input.required<DetailModele>();
  protected readonly etapes = computed(() => etapesMethodologie(this.modele()));
  protected readonly glossaire = Object.entries(FEAT_LABEL);
}
