import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../../../../core/format/nombre';
import { basculer, libelleTypesChoisis } from '../../../../logique/clustering/assistant';
import { EtatAssistantClusteringService } from './etat-assistant-clustering.service';
import { STYLES_ASSISTANT } from './styles-assistant';

/**
 * Étape 1 de l'assistant — « Types de POI à clustériser » (`ClusteringWizard.tsx:299-347`).
 *
 * Défaut React corrigé : le badge « Clustérisé » s'affichait littéralement « Clustérisé » (échappement
 * dans du texte JSX).
 */
@Component({
  selector: 'mg-etape-types',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-3' },
  template: `
    <div class="intertitre">1 / 4 — Types de POI à clustériser</div>
    @if (etat.chargementTypes()) {
      <div class="mono text-[11px] text-tertiary">Chargement…</div>
    } @else {
      <div class="flex flex-col gap-1">
        @for (t of types(); track t.type) {
          <button type="button" [attr.data-type-poi]="t.type" [attr.aria-pressed]="t.choisi" (click)="basculer(t.type)"
                  class="choix px-[11px] py-2" [class.actif]="t.choisi">
            <div class="flex items-center gap-2">
              <span class="case size-3" [class.actif]="t.choisi"></span>
              <span class="mono text-[11px]" [class.text-primary]="t.choisi" [class.text-secondary]="!t.choisi">{{ t.type }}</span>
            </div>
            <div class="flex items-center gap-[10px]">
              <span class="mono text-[10px] text-tertiary">{{ t.total }} POIs</span>
              @if (t.has_clusters) { <span class="inter text-[9px] tracking-[1px] text-success">Clustérisé</span> }
            </div>
          </button>
        }
      </div>
    }
    @if (etat.types().length > 0) { <div class="mono text-[10px] text-teal">{{ libelleChoix() }}</div> }
  `,
  styles: [STYLES_ASSISTANT],
})
export class EtapeTypesComponent {
  protected readonly etat = inject(EtatAssistantClusteringService);
  protected readonly types = computed(() => this.etat.typesPoi().map((t) => ({
    ...t, total: formaterNombre(t.total), choisi: this.etat.types().includes(t.type),
  })));
  protected readonly libelleChoix = computed(() => libelleTypesChoisis(this.etat.types().length));

  protected basculer(type: string): void {
    this.etat.types.update((l) => basculer(l, type));
  }
}
